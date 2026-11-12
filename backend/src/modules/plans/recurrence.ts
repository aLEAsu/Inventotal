import { addDays, addMonthsClamped, daysBetween, daysInMonth } from '../../common/dates';

export type FrequencyType =
  | 'SEMANAL' | 'QUINCENAL' | 'MENSUAL' | 'BIMESTRAL' | 'TRIMESTRAL' | 'CUATRIMESTRAL'
  | 'SEMESTRAL' | 'ANUAL' | 'PERSONALIZADO' | 'FECHAS_ESPECIFICAS' | 'SEMANA_DEL_MES';
export type IntervalUnit = 'DIAS' | 'SEMANAS' | 'MESES';

export interface RecurrenceRule {
  frequencyType: FrequencyType;
  intervalValue?: number | null;
  intervalUnit?: IntervalUnit | null;
  /** ["MM-DD", ...] para FECHAS_ESPECIFICAS */
  specificDates?: string[] | null;
  monthsOfYear?: number[] | null;
  weekOfMonth?: number | null;
  dayOfWeek?: number | null;
  /** 'YYYY-MM-DD' inicio de vigencia del programa */
  startDate: string;
  /** 'YYYY-MM-DD' ancla de cálculo de recurrencias */
  baseDate: string;
  /** 'YYYY-MM-DD' fin de vigencia (opcional) */
  endDate?: string | null;
}

const MONTH_STEP: Partial<Record<FrequencyType, number>> = {
  MENSUAL: 1, BIMESTRAL: 2, TRIMESTRAL: 3, CUATRIMESTRAL: 4, SEMESTRAL: 6, ANUAL: 12,
};
const DAY_STEP: Partial<Record<FrequencyType, number>> = { SEMANAL: 7, QUINCENAL: 15 };

/** Paso de la regla: { months } o { days } */
export function ruleStep(r: RecurrenceRule): { months?: number; days?: number } {
  if (MONTH_STEP[r.frequencyType]) return { months: MONTH_STEP[r.frequencyType] };
  if (DAY_STEP[r.frequencyType]) return { days: DAY_STEP[r.frequencyType] };
  if (r.frequencyType === 'PERSONALIZADO') {
    const n = r.intervalValue ?? 0;
    if (!Number.isInteger(n) || n <= 0) throw new Error('Intervalo personalizado inválido');
    if (r.intervalUnit === 'DIAS') return { days: n };
    if (r.intervalUnit === 'SEMANAS') return { days: n * 7 };
    if (r.intervalUnit === 'MESES') return { months: n };
    throw new Error('Unidad de intervalo inválida');
  }
  return {};
}

export function validateRule(r: RecurrenceRule): string[] {
  const errs: string[] = [];
  if (r.baseDate < r.startDate) errs.push('La fecha base no puede ser anterior a la fecha de inicio');
  if (r.endDate && r.endDate < r.startDate) errs.push('La fecha fin no puede ser anterior a la fecha de inicio');
  if (r.frequencyType === 'PERSONALIZADO') {
    if (!r.intervalValue || r.intervalValue <= 0) errs.push('Indique el intervalo personalizado (mayor que cero)');
    if (!r.intervalUnit) errs.push('Indique la unidad del intervalo personalizado');
    if (r.intervalUnit === 'DIAS' && (r.intervalValue ?? 0) < 1) errs.push('Intervalo en días inválido');
  }
  if (r.frequencyType === 'FECHAS_ESPECIFICAS') {
    if (!r.specificDates?.length) errs.push('Indique al menos una fecha específica (MM-DD)');
    for (const s of r.specificDates ?? []) {
      const m = /^(\d{2})-(\d{2})$/.exec(s);
      if (!m || Number(m[1]) < 1 || Number(m[1]) > 12 || Number(m[2]) < 1 || Number(m[2]) > daysInMonth(2024, Number(m[1]))) {
        errs.push(`Fecha específica inválida: ${s} (use MM-DD)`);
      }
    }
  }
  if (r.frequencyType === 'SEMANA_DEL_MES') {
    const months = r.monthsOfYear ?? [];
    if (!months.length || months.some((m) => !Number.isInteger(m) || m < 1 || m > 12) || new Set(months).size !== months.length) {
      errs.push('Seleccione meses válidos y sin duplicados');
    }
    if (r.weekOfMonth !== -1 && (!Number.isInteger(r.weekOfMonth) || (r.weekOfMonth ?? 0) < 1 || (r.weekOfMonth ?? 0) > 4)) {
      errs.push('Seleccione una semana del mes entre la 1.ª y la 4.ª, o la última');
    }
    if (!Number.isInteger(r.dayOfWeek) || (r.dayOfWeek ?? 0) < 1 || (r.dayOfWeek ?? 0) > 7) {
      errs.push('Seleccione un día de la semana válido');
    }
  }
  return errs;
}

/**
 * Calcula las fechas de ejecución que corresponden a un año.
 * - Las recurrencias se calculan desde la fecha base (k * paso), sin acumular desfases:
 *   p. ej. mensual con base 31/01 → 28/02 (o 29/02), 31/03, 30/04...
 * - Solo se incluyen fechas dentro de la vigencia [startDate, endDate] y del año solicitado.
 * - Resultado ordenado y sin duplicados ('YYYY-MM-DD').
 */
export function occurrencesInYear(r: RecurrenceRule, year: number): string[] {
  const errs = validateRule(r);
  if (errs.length) throw new Error(errs.join('; '));
  const yStart = `${year}-01-01`;
  const yEnd = `${year}-12-31`;
  const from = r.startDate > yStart ? r.startDate : yStart;
  const to = r.endDate && r.endDate < yEnd ? r.endDate : yEnd;
  if (from > to) return [];

  const out = new Set<string>();
  if (r.frequencyType === 'SEMANA_DEL_MES') {
    for (const month of r.monthsOfYear ?? []) {
      const firstDay = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
      const isoFirstDay = firstDay === 0 ? 7 : firstDay;
      let day: number;
      if (r.weekOfMonth === -1) {
        const lastDay = daysInMonth(year, month);
        const lastWeekday = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
        const isoLastWeekday = lastWeekday === 0 ? 7 : lastWeekday;
        day = lastDay - ((isoLastWeekday - r.dayOfWeek! + 7) % 7);
      } else {
        day = 1 + ((r.dayOfWeek! - isoFirstDay + 7) % 7) + 7 * ((r.weekOfMonth ?? 1) - 1);
      }
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (date >= from && date <= to) out.add(date);
    }
    return [...out].sort();
  }
  if (r.frequencyType === 'FECHAS_ESPECIFICAS') {
    for (const md of r.specificDates ?? []) {
      const mm = Number(md.slice(0, 2));
      const dd = Math.min(Number(md.slice(3, 5)), daysInMonth(year, mm));
      const date = `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      if (date >= from && date <= to) out.add(date);
    }
    return [...out].sort();
  }

  const step = ruleStep(r);
  if (step.days) {
    // primer k tal que base + k*step >= from (k puede ser negativo, acotado por startDate)
    const k0 = Math.ceil(daysBetween(r.baseDate, from) / step.days);
    for (let k = k0; ; k++) {
      const date = addDays(r.baseDate, k * step.days);
      if (date > to) break;
      if (date >= from) out.add(date);
    }
  } else if (step.months) {
    const anchorDay = Number(r.baseDate.slice(8, 10));
    const baseIdx = Number(r.baseDate.slice(0, 4)) * 12 + Number(r.baseDate.slice(5, 7)) - 1;
    const fromIdx = Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7)) - 1;
    const k0 = Math.floor((fromIdx - baseIdx) / step.months) - 1;
    for (let k = k0; ; k++) {
      const date = addMonthsClamped(r.baseDate, k * step.months, anchorDay);
      if (date > to) break;
      if (date >= from) out.add(date);
    }
  }
  return [...out].sort();
}

export const FREQUENCY_LABELS: Record<FrequencyType, string> = {
  SEMANAL: 'Semanal', QUINCENAL: 'Quincenal (15 días)', MENSUAL: 'Mensual', BIMESTRAL: 'Bimestral',
  TRIMESTRAL: 'Trimestral', CUATRIMESTRAL: 'Cuatrimestral', SEMESTRAL: 'Semestral', ANUAL: 'Anual',
  PERSONALIZADO: 'Intervalo personalizado', FECHAS_ESPECIFICAS: 'Fechas específicas', SEMANA_DEL_MES: 'Semana específica del mes',
};

export function describeRule(r: Pick<RecurrenceRule, 'frequencyType' | 'intervalValue' | 'intervalUnit' | 'specificDates' | 'monthsOfYear' | 'weekOfMonth' | 'dayOfWeek'>): string {
  if (r.frequencyType === 'SEMANA_DEL_MES') {
    const months = (r.monthsOfYear ?? []).map((m) => ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'][m - 1]).join(', ');
    const week = r.weekOfMonth === -1 ? 'última' : `${r.weekOfMonth}.ª`;
    const weekday = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'][(r.dayOfWeek ?? 1) - 1];
    return `${months} · ${week} semana, ${weekday}`;
  }
  if (r.frequencyType === 'PERSONALIZADO') {
    const u = { DIAS: 'día(s)', SEMANAS: 'semana(s)', MESES: 'mes(es)' }[r.intervalUnit ?? 'DIAS'];
    return `Cada ${r.intervalValue} ${u}`;
  }
  if (r.frequencyType === 'FECHAS_ESPECIFICAS') {
    return `Fechas: ${(r.specificDates ?? []).map((s) => `${s.slice(3, 5)}/${s.slice(0, 2)}`).join(', ')}`;
  }
  return FREQUENCY_LABELS[r.frequencyType];
}
