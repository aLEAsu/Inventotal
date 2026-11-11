import { addDays, addMonthsClamped, daysBetween, daysInMonth } from '../../common/dates';

export type FrequencyType =
  | 'SEMANAL' | 'QUINCENAL' | 'MENSUAL' | 'BIMESTRAL' | 'TRIMESTRAL' | 'CUATRIMESTRAL'
  | 'SEMESTRAL' | 'ANUAL' | 'PERSONALIZADO' | 'FECHAS_ESPECIFICAS';
export type IntervalUnit = 'DIAS' | 'SEMANAS' | 'MESES';

export interface RecurrenceRule {
  frequencyType: FrequencyType;
  intervalValue?: number | null;
  intervalUnit?: IntervalUnit | null;
  /** ["MM-DD", ...] para FECHAS_ESPECIFICAS */
  specificDates?: string[] | null;
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
  PERSONALIZADO: 'Intervalo personalizado', FECHAS_ESPECIFICAS: 'Fechas específicas',
};

export function describeRule(r: Pick<RecurrenceRule, 'frequencyType' | 'intervalValue' | 'intervalUnit' | 'specificDates'>): string {
  if (r.frequencyType === 'PERSONALIZADO') {
    const u = { DIAS: 'día(s)', SEMANAS: 'semana(s)', MESES: 'mes(es)' }[r.intervalUnit ?? 'DIAS'];
    return `Cada ${r.intervalValue} ${u}`;
  }
  if (r.frequencyType === 'FECHAS_ESPECIFICAS') {
    return `Fechas: ${(r.specificDates ?? []).map((s) => `${s.slice(3, 5)}/${s.slice(0, 2)}`).join(', ')}`;
  }
  return FREQUENCY_LABELS[r.frequencyType];
}
