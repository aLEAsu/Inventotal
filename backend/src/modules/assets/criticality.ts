export type Level = 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAJA';

export interface CriterionDef {
  code: string;
  weight: number;
  maxScore: number;
}

/**
 * Puntaje ponderado normalizado a escala 1..5.
 * Cada criterio se puntúa 1..maxScore, se normaliza a 1..5 y se pondera por su peso.
 * El resultado sirve para PRIORIZAR (inspecciones, atención de fallas, seguimiento);
 * NO determina frecuencias de mantenimiento.
 */
export function computeCriticality(
  criteria: CriterionDef[],
  scores: Record<string, number>,
  thresholds: { CRITICA: number; ALTA: number; MEDIA: number },
): { total: number; level: Level; detail: Record<string, { score: number; weight: number; maxScore: number }> } {
  const totalWeight = criteria.reduce((s, c) => s + c.weight, 0);
  if (totalWeight <= 0) throw new Error('La suma de ponderaciones debe ser mayor que cero');
  let acc = 0;
  const detail: Record<string, { score: number; weight: number; maxScore: number }> = {};
  for (const c of criteria) {
    const s = scores[c.code];
    if (s === undefined || !Number.isInteger(s) || s < 1 || s > c.maxScore) {
      throw new Error(`Puntuación inválida para el criterio ${c.code} (1 a ${c.maxScore})`);
    }
    const norm = 1 + ((s - 1) * 4) / (c.maxScore - 1);
    acc += norm * (c.weight / totalWeight);
    detail[c.code] = { score: s, weight: c.weight, maxScore: c.maxScore };
  }
  const total = Math.round(acc * 100) / 100;
  return { total, level: levelFor(total, thresholds), detail };
}

export function levelFor(total: number, t: { CRITICA: number; ALTA: number; MEDIA: number }): Level {
  if (total >= t.CRITICA) return 'CRITICA';
  if (total >= t.ALTA) return 'ALTA';
  if (total >= t.MEDIA) return 'MEDIA';
  return 'BAJA';
}
