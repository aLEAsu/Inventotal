import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Parámetros configurables. Los valores por defecto son PUNTOS DE PARTIDA operativos,
 * no requisitos normativos: deben validarse con el responsable técnico y la normativa vigente.
 */
export const DEFAULT_SETTINGS: Record<string, { value: unknown; description: string }> = {
  'institution.name': { value: 'Clínica (configure el nombre institucional)', description: 'Nombre de la institución en formatos e informes' },
  'institution.nit': { value: '', description: 'NIT de la institución' },
  'institution.address': { value: '', description: 'Dirección' },
  'institution.city': { value: '', description: 'Ciudad' },
  'institution.primaryColor': { value: '#0f5c7a', description: 'Color institucional principal (identidad gráfica)' },
  'institution.shortName': { value: 'SIGM', description: 'Sigla mostrada en la interfaz' },
  'app.publicUrl': { value: 'http://localhost:8080', description: 'URL interna del sistema (para códigos QR)' },
  'schedule.upcomingDays': { value: 15, description: 'Días de anticipación para marcar una actividad como "Próxima"' },
  'plan.documentCodePrefix': { value: 'F-02', description: 'Código documental del plan anual' },
  'auth.maxFailedAttempts': { value: 5, description: 'Intentos fallidos antes del bloqueo temporal' },
  'auth.lockMinutes': { value: 15, description: 'Minutos de bloqueo tras intentos fallidos' },
  'auth.passwordMinLength': { value: 10, description: 'Longitud mínima de contraseña' },
  'workorders.allowSelfVerification': { value: false, description: 'Permitir que el ejecutor valide su propia orden' },
  'failures.priorityWeights': {
    value: { safety: 35, care: 25, continuity: 20, criticality: 20 },
    description: 'Ponderación (%) de criterios para priorizar fallas',
  },
  'failures.priorityThresholds': {
    value: { URGENTE: 4.0, ALTA: 3.0, MEDIA: 2.0 },
    description: 'Puntaje mínimo (1-5) para cada prioridad; por debajo de MEDIA es BAJA',
  },
  'failures.safetyMaxForcesUrgent': { value: true, description: 'Impacto máximo en seguridad del paciente fuerza prioridad URGENTE' },
  'failures.recurrence': { value: { count: 3, days: 90 }, description: 'Falla recurrente: N fallas del mismo activo en D días' },
  'criticality.thresholds': {
    value: { CRITICA: 4.0, ALTA: 3.0, MEDIA: 2.0 },
    description: 'Puntaje ponderado mínimo (1-5) para cada nivel de criticidad',
  },
  'documents.allowedTypes': {
    value: ['application/pdf', 'image/jpeg', 'image/png'],
    description: 'Tipos MIME autorizados para adjuntos',
  },
  'documents.maxSizeMb': { value: 15, description: 'Tamaño máximo por archivo (MB)' },
  'contracts.alertDays': { value: 60, description: 'Días de anticipación para alertar vencimiento de contratos y garantías' },
  'backup.retentionDays': { value: 30, description: 'Días de retención de copias de seguridad (informativo; lo aplica el servicio de respaldo)' },
};

@Injectable()
export class SettingsService {
  private cache = new Map<string, { v: unknown; at: number }>();
  constructor(private readonly prisma: PrismaService) {}

  async get<T = unknown>(key: string): Promise<T> {
    const c = this.cache.get(key);
    if (c && Date.now() - c.at < 10_000) return c.v as T;
    const row = await this.prisma.setting.findUnique({ where: { key } });
    const v = row ? row.value : DEFAULT_SETTINGS[key]?.value;
    this.cache.set(key, { v, at: Date.now() });
    return v as T;
  }

  async all() {
    const rows = await this.prisma.setting.findMany();
    const map = new Map(rows.map((r) => [r.key, r]));
    return Object.entries(DEFAULT_SETTINGS).map(([key, d]) => ({
      key,
      value: map.get(key)?.value ?? d.value,
      description: d.description,
      updatedAt: map.get(key)?.updatedAt ?? null,
    }));
  }

  async set(key: string, value: unknown, userId: string) {
    const r = await this.prisma.setting.upsert({
      where: { key },
      update: { value: value as never, updatedById: userId },
      create: { key, value: value as never, description: DEFAULT_SETTINGS[key]?.description, updatedById: userId },
    });
    this.cache.delete(key);
    return r;
  }

  clearCache() {
    this.cache.clear();
  }
}
