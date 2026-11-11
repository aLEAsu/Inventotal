import { Injectable } from '@nestjs/common';
import type { ReqCtx } from '../../common/auth.types';
import { addDays, currentYearBogota, daysInMonth, endOfMonth, fmtYmd, instantToBogotaDate, todayBogota } from '../../common/dates';
import { toNum } from '../../common/money';
import { PrismaService } from '../../common/prisma.service';
import { areaFilter } from '../../common/scope';
import { SettingsService } from '../../common/settings.service';
import type { Prisma } from '../../generated/prisma/client';
import { displayStatus } from '../plans/plans.service';

export interface IndicatorFilters {
  year?: number;
  month?: number;
  areaId?: string;
  categoryId?: string;
  responsibleId?: string;
}

export interface ActivityLite {
  status: string;
  originalDate: string;
  committedDate: string;
  executedDate: string | null;
  addedAfterApproval: boolean;
  planApproved: boolean;
}

/** Resultado con indicación explícita de datos insuficientes */
export interface Ratio {
  value: number | null;
  numerator: number;
  denominator: number;
  insufficient: boolean;
  note?: string;
}

const ratio = (n: number, d: number, note?: string): Ratio =>
  d > 0 ? { value: Math.round((n / d) * 1000) / 10, numerator: n, denominator: d, insufficient: false, note } : { value: null, numerator: n, denominator: d, insufficient: true, note: note ?? 'Sin actividades exigibles en el periodo' };

/**
 * Cumplimiento preventivo:
 *   ejecutadas a tiempo / exigibles × 100
 * - Exigibles: actividades cuya fecha de referencia cae entre el inicio del periodo y la fecha de corte
 *   (mín(fin del periodo, hoy)). Se excluyen las CANCELADAS y NO APLICA (se informan aparte).
 * - "A tiempo": ejecutada a más tardar el último día del mes de la fecha de referencia y no después del corte.
 * - mode 'BASE': referencia = fecha originalmente aprobada, solo línea base de planes aprobados/cerrados
 *   (no incluye actividades agregadas después de la aprobación). Una reprogramación NO oculta el retraso.
 * - mode 'REPROGRAMADO': referencia = fecha comprometida vigente (reprogramaciones aprobadas).
 */
export function preventiveCompliance(acts: ActivityLite[], periodStart: string, periodEnd: string, today: string, mode: 'BASE' | 'REPROGRAMADO'): Ratio & { excluded: number } {
  const cutoff = periodEnd < today ? periodEnd : today;
  let num = 0;
  let den = 0;
  let excluded = 0;
  for (const a of acts) {
    if (mode === 'BASE' && (!a.planApproved || a.addedAfterApproval)) continue;
    const ref = mode === 'BASE' ? a.originalDate : a.committedDate;
    if (ref < periodStart || ref > cutoff) continue;
    if (a.status === 'CANCELADO' || a.status === 'NO_APLICA') {
      excluded++;
      continue;
    }
    den++;
    if (a.status === 'EJECUTADO' && a.executedDate && a.executedDate <= endOfMonth(ref) && a.executedDate <= cutoff) num++;
  }
  if (mode === 'BASE' && !acts.some((a) => a.planApproved)) {
    return { ...ratio(0, 0, 'No hay plan aprobado para el periodo: no existe línea base'), excluded };
  }
  if (cutoff < periodStart) return { ...ratio(0, 0, 'El periodo aún no ha iniciado'), excluded };
  return { ...ratio(num, den), excluded };
}

export function avgHours(pairs: [Date | null, Date | null][]): { value: number | null; n: number; insufficient: boolean } {
  const valid = pairs.filter((p): p is [Date, Date] => !!p[0] && !!p[1] && p[1] >= p[0]);
  if (!valid.length) return { value: null, n: 0, insufficient: true };
  const h = valid.reduce((s, [a, b]) => s + (b.getTime() - a.getTime()) / 3600000, 0) / valid.length;
  return { value: Math.round(h * 10) / 10, n: valid.length, insufficient: false };
}

@Injectable()
export class IndicatorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  period(f: IndicatorFilters) {
    const year = f.year ?? currentYearBogota();
    if (f.month) {
      const m = String(f.month).padStart(2, '0');
      return { year, start: `${year}-${m}-01`, end: `${year}-${m}-${String(daysInMonth(year, f.month)).padStart(2, '0')}` };
    }
    return { year, start: `${year}-01-01`, end: `${year}-12-31` };
  }

  async compute(ctx: ReqCtx, f: IndicatorFilters) {
    const today = todayBogota();
    const upcoming = await this.settings.get<number>('schedule.upcomingDays');
    const p = this.period(f);
    const startTs = new Date(`${p.start}T00:00:00-05:00`);
    const endTs = new Date(`${p.end}T23:59:59.999-05:00`);
    const assetWhere: Prisma.AssetWhereInput = {
      ...areaFilter(ctx.user),
      ...(f.areaId ? { areaId: f.areaId } : {}),
      ...(f.categoryId ? { categoryId: f.categoryId } : {}),
    };

    const [assets, activitiesRaw, workOrders, failures] = await Promise.all([
      this.prisma.asset.findMany({ where: assetWhere, select: { id: true, code: true, name: true, status: true, categoryId: true, areaId: true, category: { select: { name: true } }, area: { select: { name: true } } } }),
      this.prisma.scheduledActivity.findMany({
        where: {
          asset: assetWhere,
          plan: { year: p.year },
          ...(f.responsibleId ? { responsibleId: f.responsibleId } : {}),
        },
        select: {
          id: true, status: true, originalDate: true, committedDate: true, executedDate: true, addedAfterApproval: true,
          plan: { select: { status: true } },
          asset: { select: { id: true, code: true, name: true, category: { select: { name: true } }, area: { select: { name: true } } } },
          program: { select: { supplier: { select: { id: true, name: true } } } },
          responsible: { select: { fullName: true } },
        },
      }),
      this.prisma.workOrder.findMany({
        where: {
          asset: assetWhere,
          ...(f.responsibleId ? { assignedToId: f.responsibleId } : {}),
          OR: [{ createdAt: { gte: startTs, lte: endTs } }, { closedAt: { gte: startTs, lte: endTs } }],
        },
        select: { id: true, type: true, status: true, createdAt: true, closedAt: true, startedAt: true, finishedAt: true, totalCost: true, asset: { select: { category: { select: { name: true } } } }, supplier: { select: { name: true } } },
      }),
      this.prisma.failureReport.findMany({
        where: { asset: assetWhere, reportedAt: { gte: startTs, lte: endTs }, status: { not: 'ANULADA' }, ...(f.responsibleId ? { assignedToId: f.responsibleId } : {}) },
        select: { id: true, code: true, title: true, priority: true, status: true, reportedAt: true, firstResponseAt: true, resolvedAt: true, downtimeStart: true, downtimeEnd: true, assetId: true, asset: { select: { code: true, name: true, category: { select: { name: true } } } } },
      }),
    ]);

    const acts = activitiesRaw.map((a) => ({
      ...a,
      originalDate: fmtYmd(a.originalDate),
      committedDate: fmtYmd(a.committedDate),
      executedDate: a.executedDate ? fmtYmd(a.executedDate) : null,
      planApproved: a.plan.status === 'APROBADO' || a.plan.status === 'CERRADO',
    }));
    const inPeriod = acts.filter((a) => a.committedDate >= p.start && a.committedDate <= p.end);
    const ds = inPeriod.map((a) => displayStatus(a as never, today, upcoming));

    // ---- Indicadores generales
    const activeAssets = assets.filter((a) => !['RETIRADO', 'DADO_DE_BAJA'].includes(a.status));
    const oos = activeAssets.filter((a) => a.status === 'FUERA_DE_SERVICIO').length;
    const operative = activeAssets.filter((a) => a.status === 'OPERATIVO' || a.status === 'OPERATIVO_CON_OBSERVACIONES').length;
    const openCorrective = await this.prisma.failureReport.findMany({
      where: { asset: assetWhere, status: { in: ['REPORTADA', 'EN_EVALUACION', 'ASIGNADA', 'EN_ATENCION'] } },
      select: { id: true, code: true, title: true, priority: true, status: true, reportedAt: true, asset: { select: { id: true, code: true, name: true, criticality: true } }, area: { select: { name: true } } },
      orderBy: [{ priority: 'asc' }, { reportedAt: 'asc' }],
    });
    const closedWOs = workOrders.filter((w) => w.status === 'CERRADA' && w.closedAt && w.closedAt >= startTs && w.closedAt <= endTs);
    const cost = closedWOs.reduce((s, w) => s + toNum(w.totalCost), 0);

    const base = preventiveCompliance(acts, p.start, p.end, today, 'BASE');
    const resched = preventiveCompliance(acts, p.start, p.end, today, 'REPROGRAMADO');

    // ---- Gráficas
    const byCategory: Record<string, { programmed: number; executed: number; overdue: number }> = {};
    inPeriod.forEach((a, i) => {
      const c = a.asset.category.name;
      byCategory[c] ??= { programmed: 0, executed: 0, overdue: 0 };
      if (a.status !== 'CANCELADO' && a.status !== 'NO_APLICA') byCategory[c].programmed++;
      if (a.status === 'EJECUTADO') byCategory[c].executed++;
      if (ds[i] === 'VENCIDO') byCategory[c].overdue++;
    });
    const byMonth = Array.from({ length: 12 }, (_, m) => ({ month: m + 1, programmed: 0, executed: 0, cost: 0, preventive: 0, corrective: 0 }));
    acts.forEach((a) => {
      const m = Number(a.committedDate.slice(5, 7)) - 1;
      if (Number(a.committedDate.slice(0, 4)) !== p.year) return;
      if (a.status !== 'CANCELADO' && a.status !== 'NO_APLICA') byMonth[m].programmed++;
      if (a.status === 'EJECUTADO') byMonth[m].executed++;
    });
    workOrders.forEach((w) => {
      const createdD = instantToBogotaDate(w.createdAt);
      if (Number(createdD.slice(0, 4)) === p.year) byMonth[Number(createdD.slice(5, 7)) - 1][w.type === 'PREVENTIVA' ? 'preventive' : 'corrective']++;
      if (w.status === 'CERRADA' && w.closedAt) {
        const d = instantToBogotaDate(w.closedAt);
        if (Number(d.slice(0, 4)) === p.year) byMonth[Number(d.slice(5, 7)) - 1].cost += toNum(w.totalCost);
      }
    });
    const areaMap = new Map<string, ActivityLite[]>();
    acts.forEach((a) => {
      const k = a.asset.area.name;
      if (!areaMap.has(k)) areaMap.set(k, []);
      areaMap.get(k)!.push(a);
    });
    const complianceByArea = [...areaMap.entries()].map(([area, list]) => ({
      area, base: preventiveCompliance(list, p.start, p.end, today, 'BASE'), rescheduled: preventiveCompliance(list, p.start, p.end, today, 'REPROGRAMADO'),
    })).sort((a, b) => a.area.localeCompare(b.area));
    const supMap = new Map<string, ActivityLite[]>();
    acts.forEach((a) => {
      const s = a.program.supplier?.name;
      if (!s) return;
      if (!supMap.has(s)) supMap.set(s, []);
      supMap.get(s)!.push(a);
    });
    const complianceBySupplier = [...supMap.entries()].map(([supplier, list]) => ({ supplier, rescheduled: preventiveCompliance(list, p.start, p.end, today, 'REPROGRAMADO'), base: preventiveCompliance(list, p.start, p.end, today, 'BASE') }));

    const failuresByCategory: Record<string, number> = {};
    const failuresByAsset = new Map<string, { code: string; name: string; count: number }>();
    failures.forEach((x) => {
      failuresByCategory[x.asset.category.name] = (failuresByCategory[x.asset.category.name] ?? 0) + 1;
      const cur = failuresByAsset.get(x.assetId) ?? { code: x.asset.code, name: x.asset.name, count: 0 };
      cur.count++;
      failuresByAsset.set(x.assetId, cur);
    });
    const costByCategory: Record<string, number> = {};
    closedWOs.forEach((w) => (costByCategory[w.asset.category.name] = (costByCategory[w.asset.category.name] ?? 0) + toNum(w.totalCost)));
    const woByStatus: Record<string, number> = {};
    workOrders.filter((w) => w.createdAt >= startTs && w.createdAt <= endTs).forEach((w) => (woByStatus[w.status] = (woByStatus[w.status] ?? 0) + 1));

    // ---- Tiempos
    const responseTime = avgHours(failures.map((x) => [x.reportedAt, x.firstResponseAt]));
    const repairTime = avgHours(closedWOs.filter((w) => w.type === 'CORRECTIVA').map((w) => [w.startedAt, w.finishedAt]));
    const resolutionTime = avgHours(failures.map((x) => [x.reportedAt, x.resolvedAt]));
    const completeDowntime = failures.filter((x) => x.downtimeStart && x.downtimeEnd);
    const ongoingDowntime = failures.filter((x) => x.downtimeStart && !x.downtimeEnd).length;
    const downtimeHours = completeDowntime.reduce((s, x) => s + (x.downtimeEnd!.getTime() - x.downtimeStart!.getTime()) / 3600000, 0);
    const assetsWithFailures = failuresByAsset.size;
    const repeated = [...failuresByAsset.values()].filter((v) => v.count >= 2).length;

    const upcomingList = acts
      .filter((a) => (a.status === 'PROGRAMADO' || a.status === 'REPROGRAMADO') && a.committedDate >= today && a.committedDate <= addDays(today, upcoming))
      .sort((a, b) => a.committedDate.localeCompare(b.committedDate))
      .slice(0, 15)
      .map((a) => ({ id: a.id, date: a.committedDate, assetCode: a.asset.code, assetName: a.asset.name, area: a.asset.area.name, responsible: a.responsible?.fullName ?? null }));

    return {
      filters: { ...f, year: p.year },
      period: { start: p.start, end: p.end, cutoff: p.end < today ? p.end : today, today },
      general: {
        totalAssets: activeAssets.length,
        operativeAssets: operative,
        outOfServiceAssets: oos,
        programmed: inPeriod.filter((a) => a.status !== 'CANCELADO' && a.status !== 'NO_APLICA').length,
        executed: inPeriod.filter((a) => a.status === 'EJECUTADO').length,
        pending: ds.filter((s) => s === 'PROGRAMADO' || s === 'PROXIMO' || s === 'REPROGRAMADO' || s === 'EN_EJECUCION').length,
        overdue: ds.filter((s) => s === 'VENCIDO').length,
        openCorrective: openCorrective.length,
        urgentCorrective: openCorrective.filter((x) => x.priority === 'URGENTE').length,
        complianceBase: base,
        complianceRescheduled: resched,
        maintenanceCost: cost,
        outOfServicePct: ratio(oos, activeAssets.length, activeAssets.length ? undefined : 'Sin activos registrados'),
      },
      times: {
        meanResponseHours: responseTime,
        meanRepairHours: repairTime,
        meanResolutionHours: resolutionTime,
        downtimeHours: completeDowntime.length ? { value: Math.round(downtimeHours * 10) / 10, n: completeDowntime.length, insufficient: false, ongoing: ongoingDowntime } : { value: null, n: 0, insufficient: true, ongoing: ongoingDowntime },
        recurrenceRate: ratio(repeated, assetsWithFailures, assetsWithFailures ? 'Activos con 2 o más fallas / activos con fallas' : 'Sin fallas en el periodo'),
      },
      charts: {
        byCategory,
        byMonth,
        preventiveVsCorrective: {
          preventive: workOrders.filter((w) => w.type === 'PREVENTIVA' && w.createdAt >= startTs && w.createdAt <= endTs).length,
          corrective: workOrders.filter((w) => w.type === 'CORRECTIVA' && w.createdAt >= startTs && w.createdAt <= endTs).length,
        },
        complianceByArea,
        complianceBySupplier,
        failuresByCategory,
        topFailureAssets: [...failuresByAsset.values()].sort((a, b) => b.count - a.count).slice(0, 10),
        costByCategory,
        woByStatus,
      },
      urgentFailures: openCorrective.filter((x) => x.priority === 'URGENTE' || x.priority === 'ALTA').slice(0, 10),
      upcoming: upcomingList,
    };
  }
}

