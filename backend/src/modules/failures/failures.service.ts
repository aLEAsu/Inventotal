import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit.service';
import type { ReqCtx } from '../../common/auth.types';
import { CountersService } from '../../common/counters.service';
import { currentYearBogota } from '../../common/dates';
import { PrismaService, Tx } from '../../common/prisma.service';
import { areaFilter, assertAreaAccess, can } from '../../common/scope';
import { SettingsService } from '../../common/settings.service';
import type { AssetConditionOnReport, Criticality, FailureStatus, Priority, Prisma } from '../../generated/prisma/client';
import { AssetsService, INACTIVE_STATUSES } from '../assets/assets.service';
import { WorkOrdersService } from '../workorders/workorders.service';

export interface PriorityInputs {
  safety: number;
  care: number;
  continuity: number;
}

const CRIT_SCORE: Record<Criticality, number> = { CRITICA: 5, ALTA: 4, MEDIA: 3, BAJA: 1 };

/**
 * Prioridad por criterios configurables (seguridad del paciente, impacto asistencial,
 * continuidad del servicio y criticidad del activo), ponderados y llevados a escala 1..5.
 */
export function computePriority(
  inputs: PriorityInputs,
  criticality: Criticality,
  weights: { safety: number; care: number; continuity: number; criticality: number },
  thresholds: { URGENTE: number; ALTA: number; MEDIA: number },
  safetyMaxForcesUrgent: boolean,
): { score: number; priority: Priority } {
  for (const k of ['safety', 'care', 'continuity'] as const) {
    const v = inputs[k];
    if (!Number.isInteger(v) || v < 1 || v > 5) throw new Error(`Puntuación inválida en ${k} (1 a 5)`);
  }
  const tw = weights.safety + weights.care + weights.continuity + weights.criticality;
  if (tw <= 0) throw new Error('Ponderaciones de prioridad inválidas');
  const score = Math.round(((inputs.safety * weights.safety + inputs.care * weights.care + inputs.continuity * weights.continuity + CRIT_SCORE[criticality] * weights.criticality) / tw) * 100) / 100;
  let priority: Priority = score >= thresholds.URGENTE ? 'URGENTE' : score >= thresholds.ALTA ? 'ALTA' : score >= thresholds.MEDIA ? 'MEDIA' : 'BAJA';
  if (safetyMaxForcesUrgent && inputs.safety === 5) priority = 'URGENTE';
  return { score, priority };
}

export interface ReportInput extends PriorityInputs {
  assetId: string;
  title: string;
  description: string;
  assetCondition: AssetConditionOnReport;
  serviceImpact?: string | null;
  observations?: string | null;
  markOutOfService?: boolean;
}

@Injectable()
export class FailuresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CountersService,
    private readonly settings: SettingsService,
    private readonly assets: AssetsService,
    private readonly workOrders: WorkOrdersService,
  ) {}

  async priorityFor(inputs: PriorityInputs, crit: Criticality) {
    const [w, t, f] = await Promise.all([
      this.settings.get<{ safety: number; care: number; continuity: number; criticality: number }>('failures.priorityWeights'),
      this.settings.get<{ URGENTE: number; ALTA: number; MEDIA: number }>('failures.priorityThresholds'),
      this.settings.get<boolean>('failures.safetyMaxForcesUrgent'),
    ]);
    try {
      return computePriority(inputs, crit, w, t, f);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  readScope(ctx: ReqCtx): Prisma.FailureReportWhereInput {
    if (can(ctx.user, 'failures.read_all')) return areaFilter(ctx.user);
    return { OR: [{ reporterId: ctx.user.id }, { assignedToId: ctx.user.id }] };
  }

  async report(ctx: ReqCtx, b: ReportInput, tx0?: Tx) {
    const run = async (tx: Tx) => {
      const asset = await tx.asset.findUnique({ where: { id: b.assetId } });
      if (!asset) throw new BadRequestException('Activo inexistente');
      if (INACTIVE_STATUSES.includes(asset.status)) throw new ConflictException('El activo está retirado o dado de baja');
      if (ctx.user.scope === 'AREA') assertAreaAccess(ctx.user, asset.areaId);
      const p = await this.priorityFor(b, asset.criticality);
      const code = await this.counters.nextCode(tx, 'FA', currentYearBogota());
      const now = new Date();
      const unavailable = b.assetCondition === 'NO_FUNCIONA' || b.assetCondition === 'RIESGO_SEGURIDAD';
      const markOos = !!b.markOutOfService && can(ctx.user, 'failures.manage');
      const f = await tx.failureReport.create({
        data: {
          code, reportedAt: now, reporterId: ctx.user.id, areaId: asset.areaId, assetId: asset.id, title: b.title,
          description: b.description, assetCondition: b.assetCondition, serviceImpact: b.serviceImpact ?? null,
          priorityInputs: { safety: b.safety, care: b.care, continuity: b.continuity, criticality: asset.criticality },
          priorityScore: p.score, priority: p.priority, observations: b.observations ?? null,
          downtimeStart: unavailable || markOos ? now : null, outOfService: markOos,
        },
      });
      if (markOos && asset.status !== 'FUERA_DE_SERVICIO') {
        await this.assets.changeStatus(ctx, asset.id, 'FUERA_DE_SERVICIO', `Falla ${code}: ${b.title}`, null, tx);
      }
      await this.audit.log(ctx, { action: 'REPORTAR_FALLA', module: 'correctivos', entity: 'FailureReport', entityId: f.id, after: { code, priority: p.priority, score: p.score, assetId: asset.id } }, tx);
      return f;
    };
    return tx0 ? run(tx0) : this.prisma.$transaction(run);
  }

  async list(ctx: ReqCtx, q: { page: number; pageSize: number; q?: string; status?: FailureStatus; priority?: Priority; assetId?: string; areaId?: string; open?: boolean; from?: string; to?: string }) {
    const where: Prisma.FailureReportWhereInput = {
      AND: [
        this.readScope(ctx),
        q.status ? { status: q.status } : q.open ? { status: { notIn: ['CERRADA', 'ANULADA', 'RESUELTA'] } } : {},
        q.priority ? { priority: q.priority } : {},
        q.assetId ? { assetId: q.assetId } : {},
        q.areaId ? { areaId: q.areaId } : {},
        q.from || q.to ? { reportedAt: { gte: q.from ? new Date(`${q.from}T00:00:00-05:00`) : undefined, lte: q.to ? new Date(`${q.to}T23:59:59.999-05:00`) : undefined } } : {},
        q.q ? { OR: [{ code: { contains: q.q, mode: 'insensitive' } }, { title: { contains: q.q, mode: 'insensitive' } }, { asset: { code: { contains: q.q, mode: 'insensitive' } } }, { asset: { name: { contains: q.q, mode: 'insensitive' } } }] } : {},
      ],
    };
    const [items, total] = await Promise.all([
      this.prisma.failureReport.findMany({
        where,
        include: {
          asset: { select: { id: true, code: true, name: true, criticality: true, status: true } },
          area: { select: { id: true, name: true } },
          reporter: { select: { id: true, fullName: true } },
          assignedTo: { select: { id: true, fullName: true } },
        },
        orderBy: [{ reportedAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.failureReport.count({ where }),
    ]);
    const recurring = await this.recurringAssetIds();
    return { items: items.map((f) => ({ ...f, recurring: recurring.has(f.assetId) })), total };
  }

  async get(ctx: ReqCtx, id: string) {
    const f = await this.prisma.failureReport.findUnique({
      where: { id },
      include: {
        asset: { include: { area: true, category: true, location: true } },
        area: true,
        reporter: { select: { id: true, fullName: true } },
        assignedTo: { select: { id: true, fullName: true } },
        releasedBy: { select: { id: true, fullName: true } },
        workOrders: { select: { id: true, code: true, status: true, type: true, assignedTo: { select: { fullName: true } }, createdAt: true } },
        resolvedBy: { select: { id: true, code: true } },
        documents: { where: { voidedAt: null }, orderBy: { uploadedAt: 'desc' } },
      },
    });
    if (!f) throw new NotFoundException('Reporte de falla no encontrado');
    if (can(ctx.user, 'failures.read_all')) assertAreaAccess(ctx.user, f.areaId);
    else if (f.reporterId !== ctx.user.id && f.assignedToId !== ctx.user.id) throw new ForbiddenException('No tiene acceso a este reporte');
    const history = await this.prisma.failureReport.count({ where: { assetId: f.assetId } });
    const recurring = await this.recurringAssetIds();
    return { ...f, assetFailureCount: history, recurring: recurring.has(f.assetId) };
  }

  private async lock(tx: Tx, id: string, ctx: ReqCtx) {
    await tx.$queryRaw`SELECT id FROM failure_reports WHERE id = ${id}::uuid FOR UPDATE`;
    const f = await tx.failureReport.findUnique({ where: { id }, include: { asset: true } });
    if (!f) throw new NotFoundException('Reporte de falla no encontrado');
    assertAreaAccess(ctx.user, f.areaId);
    return f;
  }

  /** Evaluación y clasificación por la coordinación */
  async evaluate(ctx: ReqCtx, id: string, b: { safety?: number; care?: number; continuity?: number; priority?: Priority | null; overrideReason?: string | null; markOutOfService?: boolean; note?: string | null }) {
    return this.prisma.$transaction(async (tx) => {
      const f = await this.lock(tx, id, ctx);
      if (['RESUELTA', 'CERRADA', 'ANULADA'].includes(f.status)) throw new ConflictException(`El reporte está ${f.status}`);
      const prev = f.priorityInputs as unknown as PriorityInputs;
      const inputs = { safety: b.safety ?? prev.safety, care: b.care ?? prev.care, continuity: b.continuity ?? prev.continuity };
      const p = await this.priorityFor(inputs, f.asset.criticality);
      let priority = p.priority;
      if (b.priority && b.priority !== p.priority) {
        if (!b.overrideReason || b.overrideReason.trim().length < 10) throw new BadRequestException('Justifique el cambio de prioridad respecto a la calculada (mín. 10 caracteres)');
        priority = b.priority;
      }
      const now = new Date();
      const data: Prisma.FailureReportUncheckedUpdateInput = {
        priorityInputs: { ...inputs, criticality: f.asset.criticality }, priorityScore: p.score, priority,
        priorityOverrideReason: b.priority && b.priority !== p.priority ? b.overrideReason : null,
        status: f.status === 'REPORTADA' ? 'EN_EVALUACION' : f.status,
        firstResponseAt: f.firstResponseAt ?? now,
        observations: b.note ? [f.observations, `[Evaluación] ${b.note}`].filter(Boolean).join('\n') : undefined,
      };
      if (b.markOutOfService && !f.outOfService) {
        Object.assign(data, { outOfService: true, downtimeStart: f.downtimeStart ?? now });
        if (f.asset.status !== 'FUERA_DE_SERVICIO') await this.assets.changeStatus(ctx, f.assetId, 'FUERA_DE_SERVICIO', `Falla ${f.code} (evaluación)`, null, tx);
      }
      const updated = await tx.failureReport.update({ where: { id }, data });
      await this.audit.log(ctx, { action: 'EVALUAR_FALLA', module: 'correctivos', entity: 'FailureReport', entityId: id, before: { priority: f.priority, status: f.status }, after: { priority, score: p.score, status: updated.status, outOfService: updated.outOfService }, reason: b.overrideReason ?? b.note }, tx);
      return updated;
    });
  }

  /** Asigna el responsable y genera (si no existe) la orden de trabajo correctiva */
  async assign(ctx: ReqCtx, id: string, b: { assignedToId: string; supplierId?: string | null; note?: string | null; dueDate?: string | null }) {
    return this.prisma.$transaction(async (tx) => {
      const f = await this.lock(tx, id, ctx);
      if (['RESUELTA', 'CERRADA', 'ANULADA'].includes(f.status)) throw new ConflictException(`El reporte está ${f.status}`);
      const active = await tx.workOrder.findFirst({ where: { failureReportId: id, status: { notIn: ['CERRADA', 'CANCELADA'] } } });
      const now = new Date();
      let wo = active;
      if (!active) {
        wo = await this.workOrders.create(ctx, {
          type: 'CORRECTIVA', assetId: f.assetId, title: `Correctivo: ${f.title}`, description: f.description, priority: f.priority,
          assignedToId: b.assignedToId, supplierId: b.supplierId ?? null, failureReportId: id, dueDate: b.dueDate ?? null, interventionType: 'CORRECTIVO',
        }, tx);
      } else {
        if (active.status === 'PENDIENTE_VALIDACION') throw new ConflictException('La orden activa está pendiente de validación; no puede reasignarse');
        await tx.workOrder.update({
          where: { id: active.id },
          data: { assignedToId: b.assignedToId, status: active.status === 'ABIERTA' ? 'ASIGNADA' : active.status, supplierId: b.supplierId === undefined ? undefined : b.supplierId },
        });
        await tx.workOrderEvent.create({
          data: { workOrderId: active.id, userId: ctx.user.id, action: 'REASIGNAR', fromStatus: active.status, toStatus: active.status === 'ABIERTA' ? 'ASIGNADA' : active.status, note: b.note ?? null, changes: { from: active.assignedToId, to: b.assignedToId } },
        });
      }
      const updated = await tx.failureReport.update({ where: { id }, data: { assignedToId: b.assignedToId, status: f.status === 'EN_ATENCION' ? 'EN_ATENCION' : 'ASIGNADA', firstResponseAt: f.firstResponseAt ?? now } });
      await this.audit.log(ctx, { action: 'ASIGNAR_FALLA', module: 'correctivos', entity: 'FailureReport', entityId: id, after: { assignedToId: b.assignedToId, workOrder: wo?.code }, reason: b.note }, tx);
      return { ...updated, workOrder: wo };
    });
  }

  /** Autorización de liberación del activo por el responsable técnico (cuando no se hizo al cerrar la OT) */
  async release(ctx: ReqCtx, id: string, note: string) {
    return this.prisma.$transaction(async (tx) => {
      const f = await this.lock(tx, id, ctx);
      if (f.status !== 'RESUELTA') throw new ConflictException('Solo se liberan activos de fallas resueltas');
      if (f.releaseAuthorizedAt) throw new ConflictException('La liberación ya fue autorizada');
      if (f.asset.criticality === 'CRITICA' && !ctx.user.isTechnicalStaff) {
        throw new ForbiddenException('Activo CRÍTICO: la liberación requiere un responsable con competencia técnica certificada');
      }
      const now = new Date();
      if (['FUERA_DE_SERVICIO', 'EN_MANTENIMIENTO'].includes(f.asset.status)) {
        await this.assets.changeStatus(ctx, f.assetId, 'OPERATIVO', `Liberación autorizada (${f.code}): ${note}`, null, tx);
      }
      const updated = await tx.failureReport.update({
        where: { id },
        data: { releaseAuthorizedById: ctx.user.id, releaseAuthorizedAt: now, releaseNote: note, downtimeEnd: f.downtimeStart && !f.downtimeEnd ? now : undefined },
      });
      await this.audit.log(ctx, { action: 'LIBERAR_ACTIVO', module: 'correctivos', entity: 'FailureReport', entityId: id, after: { releaseAuthorizedAt: now }, reason: note }, tx);
      return updated;
    });
  }

  async close(ctx: ReqCtx, id: string, note: string) {
    return this.prisma.$transaction(async (tx) => {
      const f = await this.lock(tx, id, ctx);
      if (f.status !== 'RESUELTA') throw new ConflictException('Solo se cierran reportes resueltos');
      if (f.outOfService && !f.releaseAuthorizedAt && ['FUERA_DE_SERVICIO', 'EN_MANTENIMIENTO'].includes(f.asset.status)) {
        throw new ConflictException('El activo sigue fuera de servicio: registre la autorización de liberación o documente su condición antes de cerrar');
      }
      const updated = await tx.failureReport.update({ where: { id }, data: { status: 'CERRADA', closedAt: new Date(), observations: [f.observations, `[Cierre] ${note}`].filter(Boolean).join('\n') } });
      await this.audit.log(ctx, { action: 'CERRAR_FALLA', module: 'correctivos', entity: 'FailureReport', entityId: id, reason: note }, tx);
      return updated;
    });
  }

  async cancel(ctx: ReqCtx, id: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const f = await this.lock(tx, id, ctx);
      if (['RESUELTA', 'CERRADA', 'ANULADA'].includes(f.status)) throw new ConflictException(`El reporte está ${f.status}`);
      const active = await tx.workOrder.count({ where: { failureReportId: id, status: { notIn: ['CERRADA', 'CANCELADA'] } } });
      if (active) throw new ConflictException('Cancele primero la orden de trabajo activa');
      const updated = await tx.failureReport.update({ where: { id }, data: { status: 'ANULADA', cancelReason: reason, closedAt: new Date() } });
      await this.audit.log(ctx, { action: 'ANULAR_FALLA', module: 'correctivos', entity: 'FailureReport', entityId: id, before: { status: f.status }, reason }, tx);
      return updated;
    });
  }

  async fromWorkOrderFinding(ctx: ReqCtx, woId: string, b: PriorityInputs & { title: string; description: string; assetCondition: AssetConditionOnReport }) {
    return this.prisma.$transaction(async (tx) => {
      const parent = await tx.workOrder.findUnique({ where: { id: woId } });
      if (!parent) throw new NotFoundException('Orden no encontrada');
      if (parent.assignedToId !== ctx.user.id && !can(ctx.user, 'workorders.assign')) throw new ForbiddenException('Solo el ejecutor o la coordinación pueden registrar hallazgos');
      const f = await this.report(ctx, { ...b, assetId: parent.assetId, observations: `Detectada durante la orden ${parent.code}` }, tx);
      const wo = await this.workOrders.create(ctx, {
        type: 'CORRECTIVA', assetId: parent.assetId, title: `Correctivo: ${b.title}`, description: b.description, priority: f.priority,
        failureReportId: f.id, parentWorkOrderId: parent.id, interventionType: 'CORRECTIVO',
      }, tx);
      await tx.workOrderEvent.create({ data: { workOrderId: parent.id, userId: ctx.user.id, action: 'GENERAR_CORRECTIVA', fromStatus: parent.status, toStatus: parent.status, note: `Falla ${f.code} → ${wo.code}` } });
      return { failure: f, workOrder: wo };
    });
  }

  /** Activos con fallas recurrentes: N o más fallas en los últimos D días (parámetro configurable) */
  async recurringAssetIds(): Promise<Set<string>> {
    const r = await this.settings.get<{ count: number; days: number }>('failures.recurrence');
    const since = new Date(Date.now() - r.days * 86400_000);
    const rows = await this.prisma.failureReport.groupBy({ by: ['assetId'], where: { reportedAt: { gte: since }, status: { not: 'ANULADA' } }, _count: true });
    return new Set(rows.filter((x) => x._count >= r.count).map((x) => x.assetId));
  }

  async recurring(ctx: ReqCtx) {
    const r = await this.settings.get<{ count: number; days: number }>('failures.recurrence');
    const since = new Date(Date.now() - r.days * 86400_000);
    const rows = await this.prisma.failureReport.groupBy({
      by: ['assetId'], where: { reportedAt: { gte: since }, status: { not: 'ANULADA' }, ...areaFilter(ctx.user) }, _count: true,
      orderBy: { _count: { assetId: 'desc' } },
    });
    const filtered = rows.filter((x) => x._count >= r.count);
    const assets = await this.prisma.asset.findMany({ where: { id: { in: filtered.map((f) => f.assetId) } }, include: { area: true, category: true } });
    const failures = await this.prisma.failureReport.findMany({ where: { assetId: { in: filtered.map((f) => f.assetId) }, reportedAt: { gte: since }, status: { not: 'ANULADA' } }, orderBy: { reportedAt: 'desc' }, select: { id: true, code: true, title: true, reportedAt: true, status: true, assetId: true, priority: true } });
    return {
      rule: r,
      items: filtered.map((f) => ({ asset: assets.find((a) => a.id === f.assetId), count: f._count, failures: failures.filter((x) => x.assetId === f.assetId) })),
    };
  }
}
