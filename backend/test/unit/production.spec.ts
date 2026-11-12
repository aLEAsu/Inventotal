import { describeDbError, poolConfig } from '../../src/common/prisma.service';
import { StorageService } from '../../src/common/storage.service';

describe('Configuración de producción', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  describe('poolConfig (conexión a PostgreSQL)', () => {
    it('cifra siempre la conexión a Supabase sin depender de la CA del sistema', () => {
      const pooler = poolConfig('postgresql://postgres.ref:x@aws-0-us-east-1.pooler.supabase.com:6543/postgres');
      expect(pooler.ssl).toEqual({ rejectUnauthorized: false });
      const direct = poolConfig('postgresql://postgres:x@db.ref.supabase.co:5432/postgres?sslmode=require');
      expect(direct.ssl).toEqual({ rejectUnauthorized: false });
      expect(direct.connectionString).not.toContain('sslmode');
    });

    it('verifica el certificado cuando se define DB_SSL_CA', () => {
      process.env.DB_SSL_CA = '-----BEGIN CERTIFICATE-----\\nABC\\n-----END CERTIFICATE-----';
      const c = poolConfig('postgresql://postgres:x@db.ref.supabase.co:5432/postgres?sslmode=require');
      expect(c.ssl).toEqual({ ca: '-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----', rejectUnauthorized: true });
    });

    it('respeta sslmode=verify-full y no toca bases locales', () => {
      expect(poolConfig('postgresql://p:x@db.ref.supabase.co:5432/postgres?sslmode=verify-full').ssl).toBeUndefined();
      const local = poolConfig('postgresql://sigm:x@localhost:55432/sigm?schema=public');
      expect(local.ssl).toBeUndefined();
      expect(local.connectionString).toBe('postgresql://sigm:x@localhost:55432/sigm?schema=public');
    });

    it('acota el pool para instancias serverless', () => {
      expect(poolConfig('postgresql://a@localhost/x').max).toBe(5);
      process.env.DB_POOL_MAX = '2';
      expect(poolConfig('postgresql://a@localhost/x').max).toBe(2);
    });
  });

  it('describe los fallos de base de datos sin exponer host ni credenciales', () => {
    const unreachable = { code: 'P2010', meta: { driverAdapterError: { cause: { kind: 'DatabaseNotReachable', host: 'secreto.example.com' } } } };
    expect(describeDbError(unreachable)).toMatch(/no se puede alcanzar/);
    expect(describeDbError(unreachable)).not.toContain('secreto');
    expect(describeDbError({ code: 'ECONNREFUSED' })).toMatch(/rechazada/);
    expect(describeDbError(new Error('x'))).toBe('error de conexión con la base de datos');
  });

  it('usa Supabase Storage solo cuando hay URL y clave de servicio', () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(new StorageService().remote).toBe(false);
    process.env.SUPABASE_URL = 'https://ref.supabase.co/';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-prueba';
    expect(new StorageService().remote).toBe(true);
  });
});
