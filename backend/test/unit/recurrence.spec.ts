import { addMonthsClamped, currentYearBogota, todayBogota } from '../../src/common/dates';
import { occurrencesInYear, RecurrenceRule, validateRule } from '../../src/modules/plans/recurrence';

const rule = (r: Partial<RecurrenceRule>): RecurrenceRule => ({ frequencyType: 'MENSUAL', startDate: '2025-01-01', baseDate: '2025-01-10', ...r });

describe('Motor de recurrencias del cronograma', () => {
  it('mensual: 12 fechas en el año, mismo día ancla', () => {
    const d = occurrencesInYear(rule({}), 2026);
    expect(d).toHaveLength(12);
    expect(d[0]).toBe('2026-01-10');
    expect(d[11]).toBe('2026-12-10');
  });

  it('mensual con día 31: se ajusta al último día del mes sin acumular desfase', () => {
    const d = occurrencesInYear(rule({ baseDate: '2025-01-31' }), 2026);
    expect(d).toContain('2026-02-28');
    expect(d).toContain('2026-03-31');
    expect(d).toContain('2026-04-30');
    expect(occurrencesInYear(rule({ baseDate: '2025-01-31' }), 2028)).toContain('2028-02-29'); // bisiesto
  });

  it('trimestral: 4 fechas, respetando la fecha base de un año anterior', () => {
    expect(occurrencesInYear(rule({ frequencyType: 'TRIMESTRAL', baseDate: '2025-02-15' }), 2026)).toEqual(['2026-02-15', '2026-05-15', '2026-08-15', '2026-11-15']);
  });

  it('semestral y anual', () => {
    expect(occurrencesInYear(rule({ frequencyType: 'SEMESTRAL', baseDate: '2025-03-01' }), 2026)).toEqual(['2026-03-01', '2026-09-01']);
    expect(occurrencesInYear(rule({ frequencyType: 'ANUAL', startDate: '2024-01-01', baseDate: '2024-07-20' }), 2026)).toEqual(['2026-07-20']);
  });

  it('bimestral y cuatrimestral', () => {
    expect(occurrencesInYear(rule({ frequencyType: 'BIMESTRAL', baseDate: '2025-01-05' }), 2026)).toHaveLength(6);
    expect(occurrencesInYear(rule({ frequencyType: 'CUATRIMESTRAL', baseDate: '2025-01-05' }), 2026)).toEqual(['2026-01-05', '2026-05-05', '2026-09-05']);
  });

  it('semanal y quincenal: intervalos exactos de 7 y 15 días a través del cambio de año', () => {
    const w = occurrencesInYear(rule({ frequencyType: 'SEMANAL', baseDate: '2025-12-29' }), 2026);
    expect(w[0]).toBe('2026-01-05');
    expect(w.length).toBeGreaterThanOrEqual(52);
    const q = occurrencesInYear(rule({ frequencyType: 'QUINCENAL', baseDate: '2025-12-25' }), 2026);
    expect(q[0]).toBe('2026-01-09');
    expect(q[1]).toBe('2026-01-24');
  });

  it('intervalo personalizado en días, semanas y meses', () => {
    expect(occurrencesInYear(rule({ frequencyType: 'PERSONALIZADO', intervalValue: 45, intervalUnit: 'DIAS', baseDate: '2026-01-01', startDate: '2026-01-01' }), 2026).slice(0, 3)).toEqual(['2026-01-01', '2026-02-15', '2026-04-01']);
    expect(occurrencesInYear(rule({ frequencyType: 'PERSONALIZADO', intervalValue: 2, intervalUnit: 'SEMANAS', baseDate: '2026-01-01', startDate: '2026-01-01' }), 2026)).toHaveLength(27);
    expect(occurrencesInYear(rule({ frequencyType: 'PERSONALIZADO', intervalValue: 5, intervalUnit: 'MESES', baseDate: '2025-01-10' }), 2026)).toEqual(['2026-04-10', '2026-09-10']);
  });

  it('fechas específicas (MM-DD) repetidas cada año; 29/02 en año no bisiesto → 28/02', () => {
    expect(occurrencesInYear(rule({ frequencyType: 'FECHAS_ESPECIFICAS', specificDates: ['09-15', '03-15'] }), 2026)).toEqual(['2026-03-15', '2026-09-15']);
    expect(occurrencesInYear(rule({ frequencyType: 'FECHAS_ESPECIFICAS', specificDates: ['02-29'] }), 2027)).toEqual(['2027-02-28']);
  });

  it('semana del mes: meses seleccionados y ordinal ISO del día', () => {
    expect(occurrencesInYear(rule({
      frequencyType: 'SEMANA_DEL_MES', monthsOfYear: [3, 2], weekOfMonth: 2, dayOfWeek: 1,
    }), 2026)).toEqual(['2026-02-09', '2026-03-09']);
  });

  it('semana del mes: última ocurrencia respeta el día de semana y la vigencia', () => {
    expect(occurrencesInYear(rule({
      frequencyType: 'SEMANA_DEL_MES', monthsOfYear: [2, 3], weekOfMonth: -1, dayOfWeek: 7,
      startDate: '2028-02-01', baseDate: '2028-02-01', endDate: '2028-02-29',
    }), 2028)).toEqual(['2028-02-27']);
  });

  it('fecha de inicio a mitad de año: no genera fechas anteriores al inicio', () => {
    const d = occurrencesInYear(rule({ startDate: '2026-06-01', baseDate: '2026-06-15' }), 2026);
    expect(d[0]).toBe('2026-06-15');
    expect(d).toHaveLength(7);
  });

  it('programa con inicio futuro no genera nada en años anteriores; con fin de vigencia corta el año', () => {
    expect(occurrencesInYear(rule({ startDate: '2027-01-01', baseDate: '2027-01-10' }), 2026)).toEqual([]);
    expect(occurrencesInYear(rule({ endDate: '2026-03-31' }), 2026)).toEqual(['2026-01-10', '2026-02-10', '2026-03-10']);
  });

  it('cambio de año: años futuros se calculan desde la misma ancla (sin deriva)', () => {
    const r = rule({ frequencyType: 'TRIMESTRAL', baseDate: '2025-01-31' });
    expect(occurrencesInYear(r, 2030)).toEqual(['2030-01-31', '2030-04-30', '2030-07-31', '2030-10-31']);
  });

  it('el resultado es determinístico (base de la idempotencia)', () => {
    const r = rule({ frequencyType: 'SEMANAL', baseDate: '2025-03-03' });
    expect(occurrencesInYear(r, 2026)).toEqual(occurrencesInYear(r, 2026));
  });

  it('valida reglas inválidas', () => {
    expect(validateRule(rule({ frequencyType: 'PERSONALIZADO' }))).toEqual(expect.arrayContaining([expect.stringContaining('intervalo')]));
    expect(validateRule(rule({ frequencyType: 'FECHAS_ESPECIFICAS', specificDates: ['13-01'] })).length).toBeGreaterThan(0);
    expect(validateRule(rule({ baseDate: '2024-01-01', startDate: '2025-01-01' })).length).toBeGreaterThan(0);
    expect(() => occurrencesInYear(rule({ frequencyType: 'PERSONALIZADO' }), 2026)).toThrow();
  });
});

describe('Fechas en zona horaria America/Bogota', () => {
  it('el día en Bogotá difiere de UTC cerca de la medianoche', () => {
    // 2026-01-01 03:00 UTC = 2025-12-31 22:00 en Bogotá (UTC-5)
    expect(todayBogota(new Date('2026-01-01T03:00:00Z'))).toBe('2025-12-31');
    expect(currentYearBogota(new Date('2026-01-01T03:00:00Z'))).toBe(2025);
    expect(currentYearBogota(new Date('2026-01-01T05:00:00Z'))).toBe(2026);
  });
  it('suma de meses con ajuste a fin de mes', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonthsClamped('2026-03-31', -1)).toBe('2026-02-28');
  });
});
