const copFmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 });
export function fmtCOP(v: number | string | { toString(): string } | null | undefined): string {
  if (v === null || v === undefined) return '';
  return copFmt.format(Number(v.toString()));
}
export function toNum(v: { toString(): string } | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return Number(v.toString());
}
