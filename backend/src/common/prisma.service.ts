import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Cliente de base de datos.
 * Un problema de conexión al arrancar NO detiene la API: se registra en el log y /api/health
 * responde 503 con el motivo. Así un despliegue mal configurado (p. ej. sin DATABASE_URL en
 * Vercel) se puede diagnosticar en lugar de fallar en todas las rutas.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('PrismaService');
  /** Motivo del último fallo de conexión (sin datos sensibles), o null si está conectada */
  connectionProblem: string | null = null;

  constructor() {
    const url = process.env.DATABASE_URL;
    // Sin URL se usa una dirección inválida: las consultas fallarán con un error claro en vez de tumbar el arranque
    super({ adapter: new PrismaPg(poolConfig(url || 'postgresql://sin-configurar.invalid:5432/sigm') as never) });
    if (!url) this.connectionProblem = 'DATABASE_URL no está definida';
  }

  async onModuleInit() {
    if (this.connectionProblem) {
      this.log.error(`${this.connectionProblem}: configure la variable de entorno y reinicie`);
      return;
    }
    try {
      await this.$connect();
    } catch (e) {
      this.connectionProblem = describeDbError(e);
      this.log.error(`No fue posible conectar a la base de datos al iniciar: ${(e as Error).message}`);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

/**
 * Configuración del pool de node-postgres.
 * - TLS: si la URL no fija sslmode y el host es de Supabase, se cifra siempre la conexión.
 *   Con DB_SSL_CA (certificado PEM de Supabase) además se verifica el servidor; sin él se cifra sin
 *   verificar la cadena (la CA de Supabase no está en el almacén de Node y fallaría la conexión).
 * - Pool acotado (DB_POOL_MAX, 5 por defecto): cada instancia serverless abre su propio pool.
 */
export function poolConfig(connectionString: string) {
  const ca = process.env.DB_SSL_CA?.replace(/\\n/g, '\n');
  const isSupabase = /\.supabase\.(co|com)(:|\/|$)/.test(connectionString.replace(/^[^@]*@/, ''));
  const sslMode = /[?&]sslmode=([^&]+)/.exec(connectionString)?.[1];
  let ssl: { ca?: string; rejectUnauthorized: boolean } | undefined;
  if (ca) ssl = { ca, rejectUnauthorized: true };
  else if (isSupabase && (!sslMode || sslMode === 'require' || sslMode === 'prefer')) {
    // pg interpreta sslmode=require como verificación completa: se quita y se cifra sin verificar la CA
    connectionString = connectionString.replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, '');
    ssl = { rejectUnauthorized: false };
  }
  if (ssl?.ca) connectionString = connectionString.replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, '');
  return {
    connectionString,
    options: '-c timezone=America/Bogota',
    max: Number(process.env.DB_POOL_MAX ?? 5),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ...(ssl ? { ssl } : {}),
  };
}

/** Descripción del error sin exponer host, usuario ni contraseña */
export function describeDbError(e: unknown): string {
  const err = e as { code?: string; cause?: { code?: string }; meta?: { driverAdapterError?: { cause?: { kind?: string; originalCode?: string } } } };
  const adapter = err?.meta?.driverAdapterError?.cause;
  const code = adapter?.originalCode ?? adapter?.kind ?? err?.cause?.code ?? err?.code ?? '';
  const known: Record<string, string> = {
    DatabaseNotReachable: 'no se puede alcanzar el servidor de base de datos (revise host, puerto o acceso público)',
    DatabaseDoesNotExist: 'la base de datos indicada no existe',
    AuthenticationFailed: 'usuario o contraseña de la base de datos incorrectos',
    TlsConnectionError: 'error TLS/SSL: agregue sslmode=require a DATABASE_URL',
    TableDoesNotExist: 'faltan tablas: ejecute las migraciones',
    ENOTFOUND: 'host de la base de datos no encontrado',
    ECONNREFUSED: 'conexión rechazada por el servidor de base de datos',
    ETIMEDOUT: 'tiempo de espera agotado al conectar',
    '28P01': 'usuario o contraseña de la base de datos incorrectos',
    '3D000': 'la base de datos indicada no existe',
    '42P01': 'faltan tablas: ejecute las migraciones',
  };
  return known[code] ?? (code ? `error de base de datos (${code})` : 'error de conexión con la base de datos');
}

export type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>;
