/**
 * Utilidades de fecha. Regla del sistema:
 *  - Fechas de programación son "solo fecha" (DATE) y viajan como 'YYYY-MM-DD'.
 *  - Internamente se representan como Date a medianoche UTC (así las guarda Prisma en columnas DATE).
 *  - "Hoy" se calcula SIEMPRE en la zona horaria institucional America/Bogota.
 */
export const INSTITUTION_TZ = 'America/Bogota';

const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: INSTITUTION_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Fecha de hoy en Bogotá como 'YYYY-MM-DD' */
export function todayBogota(now: Date = new Date()): string {
  return ymdFmt.format(now);
}

/** Año actual en Bogotá */
export function currentYearBogota(now: Date = new Date()): number {
  return Number(todayBogota(now).slice(0, 4));
}

/** Convierte un instante (timestamptz) a su fecha calendario en Bogotá */
export function instantToBogotaDate(d: Date): string {
  return ymdFmt.format(d);
}

export function isYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseYmd(s);
  return !Number.isNaN(d.getTime()) && fmtYmd(d) === s;
}

/** 'YYYY-MM-DD' -> Date (medianoche UTC) */
export function parseYmd(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

/** Date (medianoche UTC) -> 'YYYY-MM-DD' */
export function fmtYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function toYmdOrNull(d: Date | null | undefined): string | null {
  return d ? fmtYmd(d) : null;
}

export function addDays(ymd: string, days: number): string {
  const d = parseYmd(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return fmtYmd(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 86400000);
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Suma meses conservando el día ancla; si el mes no tiene ese día se usa el último día del mes. */
export function addMonthsClamped(ymd: string, months: number, anchorDay?: number): string {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7)) - 1;
  const day = anchorDay ?? Number(ymd.slice(8, 10));
  const total = y * 12 + m + months;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12;
  const dd = Math.min(day, daysInMonth(ny, nm + 1));
  return `${String(ny).padStart(4, '0')}-${String(nm + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

export function endOfMonth(ymd: string): string {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  return `${ymd.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
}

/** DD/MM/AAAA */
export function fmtDMY(ymdOrDate: string | Date | null | undefined): string {
  if (!ymdOrDate) return '';
  const s = typeof ymdOrDate === 'string' ? ymdOrDate : fmtYmd(ymdOrDate);
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
}

const dtFmt = new Intl.DateTimeFormat('es-CO', {
  timeZone: INSTITUTION_TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});
/** DD/MM/AAAA HH:mm en hora de Bogotá */
export function fmtDateTimeBogota(d: Date | null | undefined): string {
  if (!d) return '';
  return dtFmt.format(d).replace(',', '');
}

export const MONTHS_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
export const MONTHS_ES_SHORT = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
