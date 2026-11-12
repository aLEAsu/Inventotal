import { Injectable } from '@nestjs/common';
import type { ReqCtx } from '../../common/auth.types';
import { fmtYmd, todayBogota } from '../../common/dates';
import { toNum } from '../../common/money';
import { PrismaService } from '../../common/prisma.service';
import { can } from '../../common/scope';
import { SettingsService } from '../../common/settings.service';
import { AssetsService } from '../assets/assets.service';
import { describeRule } from '../plans/recurrence';
import { displayStatus, DISPLAY_STATUS_LABELS } from '../plans/plans.service';

/** Hoja de vida acumulativa: nunca se depura; consolida todo el historial del activo. */
@Injectable()
export class LifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: AssetsService,
    private readonly settings: SettingsService,
  ) {}

  async get(ctx: ReqCtx, assetId: string) {
    const asset = await this.assets.get(ctx, assetId);
    const today = todayBogota();
    const upcoming = await this.settings.get<number>('schedule.upcomingDays');
    const [programs, activities, workOrders, failures, documents, contracts, criticality, statusHistory] = await Promise.all([
      this.prisma.maintenanceProgram.findMany({
        where: {
          OR: [
            { assetId },
            { targetType: 'CATEGORIA', categoryId: asset.categoryId },
            ...(asset.subcategoryId ? [{ targetType: 'SUBCATEGORIA' as const, subcategoryId: asset.subcategoryId }] : []),
            { targetType: 'GRUPO', group: { assets: { some: { assetId } } } },
          ],
        },
        include: {
          category: { select: { name: true } },
          subcategory: { select: { name: true } },
          group: { select: { name: true } },
          responsible: { select: { fullName: true } },
          supplier: { select: { name: true } },
        },
        orderBy: { code: 'asc' },
      }),
      this.prisma.scheduledActivity.findMany({
        where: { assetId },
        include: { plan: { select: { year: true, status: true } }, program: { select: { code: true, name: true } }, workOrder: { select: { id: true, code: true } }, responsible: { select: { fullName: true } } },
        orderBy: { committedDate: 'desc' },
      }),
      this.prisma.workOrder.findMany({
        where: { assetId },
        include: { parts: true, assignedTo: { select: { fullName: true } }, verifiedBy: { select: { fullName: true } }, supplier: { select: { name: true } }, failureReport: { select: { code: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.failureReport.findMany({
        where: { assetId },
        include: { reporter: { select: { fullName: true } }, resolvedBy: { select: { code: true } } },
        orderBy: { reportedAt: 'desc' },
      }),
      can(ctx.user, 'documents.read')
        ? this.prisma.document.findMany({ where: { OR: [{ assetId }, { workOrder: { assetId } }, { failureReport: { assetId } }], voidedAt: null }, orderBy: { uploadedAt: 'desc' } })
        : Promise.resolve([]),
      this.prisma.contract.findMany({ where: { assets: { some: { assetId } } }, include: { supplier: { select: { name: true } } } }),
      this.prisma.criticalityAssessment.findMany({ where: { assetId }, orderBy: { assessedAt: 'desc' } }),
      this.prisma.assetStatusHistory.findMany({ where: { assetId }, orderBy: { createdAt: 'desc' } }),
    ]);
    const closed = workOrders.filter((w) => w.status === 'CERRADA');
    const costs = {
      total: closed.reduce((s, w) => s + toNum(w.totalCost), 0),
      preventive: closed.filter((w) => w.type === 'PREVENTIVA').reduce((s, w) => s + toNum(w.totalCost), 0),
      corrective: closed.filter((w) => w.type === 'CORRECTIVA').reduce((s, w) => s + toNum(w.totalCost), 0),
      parts: closed.reduce((s, w) => s + toNum(w.partsCost), 0),
    };
    const downtimeHours = failures.reduce((s, f) => (f.downtimeStart && f.downtimeEnd ? s + (f.downtimeEnd.getTime() - f.downtimeStart.getTime()) / 3600000 : s), 0);
    const userIds = [...new Set([...statusHistory.map((h) => h.userId), ...criticality.map((c) => c.assessedById), ...documents.map((d) => d.uploadedById)].filter((x): x is string => !!x))];
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    return {
      asset,
      programs: programs.map((p) => ({
        ...p,
        targetName: p.targetType === 'ACTIVO' ? asset.name : p.targetType === 'CATEGORIA' ? p.category?.name
          : p.targetType === 'SUBCATEGORIA' ? p.subcategory?.name : p.group?.name,
        frequencyLabel: describeRule(p), startDate: fmtYmd(p.startDate), baseDate: fmtYmd(p.baseDate),
        lastPerformedDate: p.lastPerformedDate ? fmtYmd(p.lastPerformedDate) : null,
      })),
      activities: activities.map((a) => {
        const ds = displayStatus(a, today, upcoming);
        return {
          id: a.id, year: a.plan.year, planStatus: a.plan.status, programCode: a.program.code, programName: a.program.name,
          originalDate: fmtYmd(a.originalDate), committedDate: fmtYmd(a.committedDate), executedDate: a.executedDate ? fmtYmd(a.executedDate) : null,
          status: a.status, displayStatus: ds, displayStatusLabel: DISPLAY_STATUS_LABELS[ds], workOrder: a.workOrder, responsible: a.responsible?.fullName ?? null,
        };
      }),
      workOrders: workOrders.map((w) => ({ ...w, scheduledDate: w.scheduledDate ? fmtYmd(w.scheduledDate) : null, dueDate: w.dueDate ? fmtYmd(w.dueDate) : null })),
      failures,
      parts: workOrders.flatMap((w) => w.parts.map((p) => ({ ...p, workOrderCode: w.code, workOrderStatus: w.status }))),
      documents: documents.map((d) => ({ ...d, storedName: undefined, uploadedBy: users.get(d.uploadedById) ?? null })),
      contracts: contracts.map((c) => ({ ...c, startDate: fmtYmd(c.startDate), endDate: fmtYmd(c.endDate) })),
      criticality: criticality.map((c) => ({ ...c, assessedBy: users.get(c.assessedById) ?? null })),
      statusHistory: statusHistory.map((h) => ({ ...h, id: h.id.toString(), user: h.userId ? users.get(h.userId) ?? null : null })),
      stats: {
        preventiveOrders: workOrders.filter((w) => w.type === 'PREVENTIVA').length,
        correctiveOrders: workOrders.filter((w) => w.type === 'CORRECTIVA').length,
        failures: failures.length,
        downtimeHours: Math.round(downtimeHours * 10) / 10,
        costs,
        lastMaintenanceDate: asset.lastMaintenanceDate,
        nextMaintenanceDate: asset.nextMaintenanceDate,
      },
    };
  }
}
