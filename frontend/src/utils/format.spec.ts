import { describe, expect, it } from 'vitest';
import { dateToYmd, fmtCOP, fmtDate, fmtDateTime, localDateTimeToIso, ymdToDate } from './format';
import { ACTIVITY_STATUS, opts, PRIORITY, WO_STATUS } from './labels';

describe('Formato de fechas institucional (DD/MM/AAAA, Bogotá)', () => {
  it('formatea fechas de programación sin desfase de zona horaria', () => {
    expect(fmtDate('2026-01-01')).toBe('01/01/2026');
    expect(fmtDate('2026-12-31')).toBe('31/12/2026');
    expect(fmtDate(null)).toBe('—');
  });
  it('formatea marcas de tiempo en hora de Bogotá (UTC-5)', () => {
    expect(fmtDateTime('2026-01-01T03:30:00Z')).toBe('31/12/2025 22:30');
  });
  it('convierte entre Date del selector y AAAA-MM-DD sin perder un día', () => {
    expect(dateToYmd(ymdToDate('2026-03-01'))).toBe('2026-03-01');
    expect(dateToYmd(null)).toBeNull();
  });
  it('envía fecha y hora del formulario con offset de Bogotá', () => {
    expect(localDateTimeToIso(new Date(2026, 4, 2, 8, 5))).toBe('2026-05-02T08:05:00-05:00');
  });
});

describe('Moneda (COP)', () => {
  it('formatea pesos colombianos sin decimales', () => {
    const s = fmtCOP(1234567).replace(/\s/g, ' ');
    expect(s).toMatch(/\$\s?1\.234\.567/);
    expect(fmtCOP(null)).toBe('—');
  });
});

describe('Etiquetas de estados', () => {
  it('todos los estados del cronograma tienen etiqueta en español y color con significado', () => {
    for (const k of ['PROGRAMADO', 'PROXIMO', 'EN_EJECUCION', 'EJECUTADO', 'VENCIDO', 'REPROGRAMADO', 'CANCELADO', 'NO_APLICA']) {
      expect(ACTIVITY_STATUS[k].label).toBeTruthy();
    }
    expect(ACTIVITY_STATUS.VENCIDO.sev).toBe('danger');
    expect(ACTIVITY_STATUS.EJECUTADO.sev).toBe('success');
    expect(PRIORITY.URGENTE.sev).toBe('danger');
  });
  it('genera opciones para selectores', () => {
    expect(opts(WO_STATUS)).toContainEqual({ value: 'PENDIENTE_VALIDACION', label: 'Pendiente de validación' });
  });
});
