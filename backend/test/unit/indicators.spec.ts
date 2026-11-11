import { computeCriticality } from '../../src/modules/assets/criticality';
import { avgHours, preventiveCompliance, type ActivityLite } from '../../src/modules/dashboard/indicators.service';
import { computePriority } from '../../src/modules/failures/failures.service';
import { displayStatus } from '../../src/modules/plans/plans.service';
import { validatePasswordPolicy } from '../../src/modules/auth/auth.service';
import { sniffMime } from '../../src/common/storage.service';
import { WO_TRANSITIONS } from '../../src/modules/workorders/workorders.service';

const act = (p: Partial<ActivityLite>): ActivityLite => ({ status: 'PROGRAMADO', originalDate: '2026-03-10', committedDate: '2026-03-10', executedDate: null, addedAfterApproval: false, planApproved: true, ...p });

describe('Cumplimiento preventivo (base vs reprogramado)', () => {
  const today = '2026-06-30';
  it('una reprogramación no oculta el retraso frente a la línea base', () => {
    const acts = [
      act({ status: 'EJECUTADO', executedDate: '2026-03-12' }), // a tiempo
      act({ status: 'EJECUTADO', originalDate: '2026-04-10', committedDate: '2026-05-20', executedDate: '2026-05-20' }), // reprogramada y cumplida
      act({ status: 'PROGRAMADO', originalDate: '2026-05-10', committedDate: '2026-05-10' }), // vencida
    ];
    const base = preventiveCompliance(acts, '2026-01-01', '2026-12-31', today, 'BASE');
    const resch = preventiveCompliance(acts, '2026-01-01', '2026-12-31', today, 'REPROGRAMADO');
    expect(base).toMatchObject({ numerator: 1, denominator: 3 });
    expect(resch).toMatchObject({ numerator: 2, denominator: 3 });
  });

  it('solo cuenta actividades exigibles hasta la fecha de corte', () => {
    const acts = [act({ originalDate: '2026-08-10', committedDate: '2026-08-10' }), act({ status: 'EJECUTADO', executedDate: '2026-03-01' })];
    const r = preventiveCompliance(acts, '2026-01-01', '2026-12-31', today, 'REPROGRAMADO');
    expect(r.denominator).toBe(1);
    expect(r.value).toBe(100);
  });

  it('excluye canceladas/no aplica (informándolas) y actividades agregadas tras aprobación en la base', () => {
    const acts = [act({ status: 'CANCELADO' }), act({ status: 'NO_APLICA' }), act({ addedAfterApproval: true, status: 'EJECUTADO', executedDate: '2026-03-10' })];
    const base = preventiveCompliance(acts, '2026-01-01', '2026-12-31', today, 'BASE');
    expect(base.excluded).toBe(2);
    expect(base.insufficient).toBe(true);
    expect(base.value).toBeNull();
  });

  it('sin plan aprobado no existe línea base (datos insuficientes, no 0 %)', () => {
    const r = preventiveCompliance([act({ planApproved: false })], '2026-01-01', '2026-12-31', today, 'BASE');
    expect(r.insufficient).toBe(true);
    expect(r.value).toBeNull();
  });

  it('ejecución después del mes de la fecha de referencia no cuenta como cumplida', () => {
    const r = preventiveCompliance([act({ status: 'EJECUTADO', executedDate: '2026-04-02' })], '2026-01-01', '2026-12-31', today, 'BASE');
    expect(r.numerator).toBe(0);
  });

  it('no calcula tiempos medios sin datos', () => {
    expect(avgHours([[new Date(), null]])).toEqual({ value: null, n: 0, insufficient: true });
    expect(avgHours([[new Date('2026-01-01T10:00:00Z'), new Date('2026-01-01T14:00:00Z')]]).value).toBe(4);
  });
});

describe('Estados dependientes del tiempo (Bogotá)', () => {
  it('vencido / próximo / programado', () => {
    expect(displayStatus({ status: 'PROGRAMADO', committedDate: '2026-05-01' }, '2026-05-02', 15)).toBe('VENCIDO');
    expect(displayStatus({ status: 'PROGRAMADO', committedDate: '2026-05-10' }, '2026-05-02', 15)).toBe('PROXIMO');
    expect(displayStatus({ status: 'REPROGRAMADO', committedDate: '2026-07-10' }, '2026-05-02', 15)).toBe('REPROGRAMADO');
    expect(displayStatus({ status: 'EJECUTADO', committedDate: '2026-01-01' }, '2026-05-02', 15)).toBe('EJECUTADO');
  });
});

describe('Criticidad y prioridad', () => {
  const criteria = [{ code: 'A', weight: 50, maxScore: 5 }, { code: 'B', weight: 50, maxScore: 5 }];
  const t = { CRITICA: 4, ALTA: 3, MEDIA: 2 };
  it('calcula nivel ponderado', () => {
    expect(computeCriticality(criteria, { A: 5, B: 5 }, t).level).toBe('CRITICA');
    expect(computeCriticality(criteria, { A: 1, B: 1 }, t).level).toBe('BAJA');
    expect(computeCriticality(criteria, { A: 3, B: 4 }, t)).toMatchObject({ total: 3.5, level: 'ALTA' });
  });
  it('rechaza puntuaciones fuera de rango', () => {
    expect(() => computeCriticality(criteria, { A: 6, B: 1 }, t)).toThrow();
    expect(() => computeCriticality(criteria, { A: 3 }, t)).toThrow();
  });
  it('prioridad de fallas: seguridad máxima fuerza URGENTE', () => {
    const w = { safety: 35, care: 25, continuity: 20, criticality: 20 };
    const th = { URGENTE: 4, ALTA: 3, MEDIA: 2 };
    expect(computePriority({ safety: 5, care: 1, continuity: 1 }, 'BAJA', w, th, true).priority).toBe('URGENTE');
    expect(computePriority({ safety: 5, care: 1, continuity: 1 }, 'BAJA', w, th, false).priority).not.toBe('URGENTE');
    expect(computePriority({ safety: 1, care: 1, continuity: 1 }, 'BAJA', w, th, true).priority).toBe('BAJA');
  });
});

describe('Seguridad', () => {
  it('política de contraseñas', () => {
    expect(validatePasswordPolicy('corta', 'x')).not.toHaveLength(0);
    expect(validatePasswordPolicy('Clave-Segura-2026', 'pepito')).toHaveLength(0);
    expect(validatePasswordPolicy('Pepito-Segura-2026', 'pepito').join()).toContain('nombre de usuario');
  });
  it('detección de tipo real de archivo (firma mágica)', () => {
    expect(sniffMime(Buffer.from('%PDF-1.7 ...'))).toBe('application/pdf');
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMime(Buffer.from('<script>alert(1)</script>'))).toBeNull();
  });
  it('transiciones de órdenes de trabajo controladas', () => {
    expect(WO_TRANSITIONS.CERRADA).toHaveLength(0);
    expect(WO_TRANSITIONS.ABIERTA).not.toContain('CERRADA');
    expect(WO_TRANSITIONS.EN_EJECUCION).not.toContain('CERRADA');
  });
});
