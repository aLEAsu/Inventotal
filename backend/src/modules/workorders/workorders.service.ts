import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit.service';
import type { ReqCtx } from '../../common/auth.types';
import { CountersService } from '../../common/counters.service';
import { currentYearBogota, fmtYmd, instantToBogotaDate, parseYmd } from '../../common/dates';
import { toNum } from '../../common/money';
import { PrismaService, Tx } from '../../common/prisma.service';
import { areaFilter, assertAreaAccess, can } from '../../common/scope';
import { SettingsService } from '../../common/settings.service';
import type { AssetStatus, FinalCondition, Priority, Prisma, WorkOrderStatus, WorkOrderType } from '../../generated/prisma/client';
import { AssetsService, INACTIVE_STATUSES } from '../assets/assets.service';

/** Transiciones permitidas de estado de una orden de trabajo */
export const WO_TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  ABIERTA: ['ASIGNADA', 'CANCELADA'],
  ASIGNADA: ['ASIGNADA', 'EN_EJECUCION', 'CANCELADA'],
  EN_EJECUCION: ['PENDIENTE_REPUESTOS', 'PENDIENTE_PROVEEDOR', 'PENDIENTE_VALIDACION', 'CANCELADA'],
  PENDIENTE_REPUESTOS: ['EN_EJECUCION', 'PENDIENTE_PROVEEDOR', 'CANCELADA'],
  PENDIENTE_PROVEEDOR: ['EN_EJECUCION', 'PENDIENTE_REPUESTOS', 'CANCELADA'],
  PENDIENTE_VALIDACION: ['CERRADA', 'EN_EJECUCION'],
  CERRADA: [],
  CANCELADA: [],
};

export function assertTransition(from: WorkOrderStatus, to: WorkOrderStatus) {
  if (!WO_TRANSITIONS[from].includes(to)) throw new ConflictException(`Transición no permitida: ${from} → ${to}`);
}

const FINAL_TO_ASSET: Record<FinalCondition, AssetStatus> = {
  OPERATIVO: 'OPERATIVO',
  OPERATIVO_CON_OBSERVACIONES: 'OPERATIVO_CON_OBSERVACIONES',
  FUERA_DE_SERVICIO: 'FUERA_DE_SERVICIO',
  REQUIERE_BAJA: 'FUERA_DE_SERVICIO',
};

export interface ChecklistResult {
  itemId: string;
  text: string;
  required: boolean;
  result: 'CUMPLE' | 'NO_CUMPLE' | 'NO_APLICA' | null;
  note?: string | null;
}

export interface ExecutionInput {
  interventionType?: string | null;
  activitiesPerformed?: string | null;
  diagnosis?: string | null;
  checklistResults?: ChecklistResult[];
  findings?: string | null;
  result?: string | null;
  testsPerformed?: string | null;
  finalCondition?: FinalCondition | null;
  laborCost?: number;
  externalCost?: number;
  startedAt?: string | null;
  finishedAt?: string | null;
}

const ACTIVE: WorkOrderStatus[] = ['ABIERTA', 'ASIGNADA', 'EN_EJECUCION', 'PENDIENTE_REPUESTOS', 'PENDIENTE_PROVEEDOR', 'PENDIENTE_VALIDACION'];

@Injectable()
export class WorkOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CountersService,
    private readonly settings: SettingsService,
    private readonly assets: AssetsService,
  ) {}

  readScope(ctx: ReqCtx): Prisma.WorkOrderWhereInput {
    if (can(ctx.user, 'workorders.read_all')) return areaFilter(ctx.user);
    return { OR: [{ assignedToId: ctx.user.id }, { createdById: ctx.user.id }] };
  }

  async list(ctx: ReqCtx, q: { page: number; pageSize: number; q?: string; type?: WorkOrderType; status?: WorkOrderStatus; priority?: Priority; assetId?: string; areaId?: string; assignedToId?: string; from?: string; to?: string; mine?: boolean; active?: boolean }) {
    const where: Prisma.WorkOrderWhereInput = {
      AND: [
        this.readScope(ctx),
        q.mine ? { assignedToId: ctx.user.id } : {},
        q.type ? { type: q.type } : {},
        q.status ? { status: q.status } : q.active ? { status: { in: ACTIVE } } : {},
        q.priority ? { priority: q.priority } : {},
        q.assetId ? { assetId: q.assetId } : {},
        q.areaId ? { areaId: q.areaId } : {},
        q.assignedToId ? { assignedToId: q.assignedToId } : {},
        q.from || q.to ? { createdAt: { gte: q.from ? new Date(`${q.from}T00:00:00-05:00`) : undefined, lte: q.to ? new Date(`${q.to}T23:59:59.999-05:00`) : undefined } } : {},
        q.q ? { OR: [{ code: { contains: q.q, mode: 'insensitive' } }, { title: { contains: q.q, mode: 'insensitive' } }, { asset: { code: { contains: q.q, mode: 'insensitive' } } }, { asset: { name: { contains: q.q, mode: 'insensitive' } } }] } : {},
      ],
    };
    const [items, total] = await Promise.all([
      this.prisma.workOrder.findMany({
        where,
        include: {
          asset: { select: { id: true, code: true, name: true, criticality: true } },
          area: { select: { id: true, name: true } },
          assignedTo: { select: { id: true, fullName: true } },
          supplier: { select: { id: true, name: true } },
        },
        orderBy: [{ createdAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.workOrder.count({ where }),
    ]);
    return { items: items.map((w) => this.present(w)), total };
  }

  present<T extends { scheduledDate: Date | null; dueDate: Date | null }>(w: T) {
    return { ...w, scheduledDate: w.scheduledDate ? fmtYmd(w.scheduledDate) : null, dueDate: w.dueDate ? fmtYmd(w.dueDate) : null };
  }

  async get(ctx: ReqCtx, id: string) {
    const w = await this.prisma.workOrder.findUnique({
      where: { id },
      include: {
        asset: { include: { area: true, category: true, location: true } },
        area: true,
        activity: { include: { plan: { select: { year: true, status: true } }, program: { select: { id: true, code: true, name: true, procedure: true, checklist: true, technicalRequirements: true, estimatedDurationMin: true } } } },
        failureReport: { select: { id: true, code: true, title: true, status: true, priority: true } },
        parent: { select: { id: true, code: true } },
        children: { select: { id: true, code: true, type: true, status: true } },
        assignedTo: { select: { id: true, fullName: true, isTechnicalStaff: true } },
        supplier: { select: { id: true, name: true } },
        createdBy: { select: { id: true, fullName: true } },
        verifiedBy: { select: { id: true, fullName: true } },
        parts: { orderBy: { createdAt: 'asc' } },
        events: { orderBy: { createdAt: 'asc' } },
        documents: { where: { voidedAt: null }, orderBy: { uploadedAt: 'desc' } },
      },
    });
    if (!w) throw new NotFoundException('Orden de trabajo no encontrada');
    this.assertRead(ctx, w);
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(w.events.map((e) => e.userId))] } }, select: { id: true, fullName: true } });
    const um = new Map(users.map((u) => [u.id, u.fullName]));
    return {
      ...this.present(w),
      activity: w.activity ? { ...w.activity, originalDate: fmtYmd(w.activity.originalDate), committedDate: fmtYmd(w.activity.committedDate), executedDate: w.activity.executedDate ? fmtYmd(w.activity.executedDate) : null } : null,
      events: w.events.map((e) => ({ ...e, id: e.id.toString(), user: um.get(e.userId) ?? null })),
    };
  }

  private assertRead(ctx: ReqCtx, w: { areaId: string; assignedToId: string | null; createdById: string }) {
    if (can(ctx.user, 'workorders.read_all')) {
      assertAreaAccess(ctx.user, w.areaId);
      return;
    }
    if (w.assignedToId !== ctx.user.id && w.createdById !== ctx.user.id) throw new ForbiddenException('No tiene acceso a esta orden de trabajo');
  }

  private assertExecutor(ctx: ReqCtx, w: { assignedToId: string | null; areaId: string }) {
    if (!can(ctx.user, 'workorders.execute')) throw new ForbiddenException('Requiere permiso workorders.execute');
    if (w.assignedToId === ctx.user.id) return;
    if (can(ctx.user, 'workorders.assign')) {
      assertAreaAccess(ctx.user, w.areaId);
      return;
    }
    throw new ForbiddenException('Solo el responsable asignado o la coordinación pueden ejecutar esta orden');
  }

  private async event(tx: Tx, woId: string, userId: string, action: string, from: WorkOrderStatus | null, to: WorkOrderStatus | null, note?: string | null, changes?: unknown) {
    await tx.workOrderEvent.create({ data: { workOrderId: woId, userId, action, fromStatus: from, toStatus: to, note: note ?? null, changes: (changes ?? undefined) as never } });
  }

  private async loadForUpdate(tx: Tx, id: string) {
    // Bloqueo de fila: evita transiciones concurrentes sobre la misma orden
    await tx.$queryRaw`SELECT id FROM work_orders WHERE id = ${id}::uuid FOR UPDATE`;
    const w = await tx.workOrder.findUnique({ where: { id }, include: { asset: true, parts: true, activity: true } });
    if (!w) throw new NotFoundException('Orden de trabajo no encontrada');
    return w;
  }

  // ------------------------------------------------------------- Creación
  async createFromActivity(ctx: ReqCtx, activityId: string, assignedToId?: string | null) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM scheduled_activities WHERE id = ${activityId}::uuid FOR UPDATE`;
      const a = await tx.scheduledActivity.findUnique({ where: { id: activityId }, include: { asset: true, program: true, plan: true, workOrder: true } });
      if (!a) throw new NotFoundException('Actividad no encontrada');
      assertAreaAccess(ctx.user, a.asset.areaId);
      if (a.workOrder) throw new ConflictException(`La actividad ya tiene la orden ${a.workOrder.code}`);
      if (!['PROGRAMADO', 'REPROGRAMADO'].includes(a.status)) throw new ConflictException(`La actividad está en estado ${a.status}`);
      if (a.plan.status === 'CERRADO') throw new ConflictException('El plan anual está cerrado');
      if (INACTIVE_STATUSES.includes(a.asset.status)) throw new ConflictException('El activo está retirado o dado de baja');
      const assignee = assignedToId ?? a.responsibleId;
      if (assignee && !can(ctx.user, 'workorders.assign') && assignee !== ctx.user.id) throw new ForbiddenException('No puede asignar órdenes a otros usuarios');
      const code = await this.counters.nextCode(tx, 'OT', currentYearBogota());
      const checklist = (a.program.checklist as { id: string; text: string; required: boolean }[]).map((i) => ({ itemId: i.id, text: i.text, required: i.required, result: null, note: null }));
      const w = await tx.workOrder.create({
        data: {
          code, type: 'PREVENTIVA', assetId: a.assetId, areaId: a.asset.areaId, activityId: a.id,
          priority: a.asset.criticality === 'CRITICA' ? 'ALTA' : 'MEDIA',
          status: assignee ? 'ASIGNADA' : 'ABIERTA', title: a.program.name, description: a.program.description,
          interventionType: a.program.kind, scheduledDate: a.committedDate, dueDate: a.committedDate,
          assignedToId: assignee, supplierId: a.program.supplierId, checklistResults: checklist, createdById: ctx.user.id,
        },
      });
      await this.event(tx, w.id, ctx.user.id, 'CREAR', null, w.status, `Generada desde la actividad programada para ${fmtYmd(a.committedDate)}`);
      // NOTA: generar la orden NO marca la actividad como ejecutada.
      await this.audit.log(ctx, { action: 'CREAR', module: 'ordenes', entity: 'WorkOrder', entityId: w.id, after: { code, type: 'PREVENTIVA', activityId } }, tx);
      return w;
    });
  }

  async create(ctx: ReqCtx, b: { type: WorkOrderType; assetId: string; title: string; description?: string | null; priority: Priority; assignedToId?: string | null; supplierId?: string | null; scheduledDate?: string | null; dueDate?: string | null; failureReportId?: string | null; parentWorkOrderId?: string | null; interventionType?: string | null }, tx0?: Tx) {
    const run = async (tx: Tx) => {
      const asset = await tx.asset.findUnique({ where: { id: b.assetId } });
      if (!asset) throw new BadRequestException('Activo inexistente');
      assertAreaAccess(ctx.user, asset.areaId);
      if (INACTIVE_STATUSES.includes(asset.status)) throw new ConflictException('El activo está retirado o dado de baja');
      if (b.assignedToId && !can(ctx.user, 'workorders.assign') && b.assignedToId !== ctx.user.id) throw new ForbiddenException('No puede asignar órdenes a otros usuarios');
      if (b.type === 'CORRECTIVA' && !b.failureReportId && !b.parentWorkOrderId) {
        throw new BadRequestException('Una orden correctiva debe vincularse a un reporte de falla o a la orden donde se detectó');
      }
      if (b.failureReportId) {
        const f = await tx.failureReport.findUniqueOrThrow({ where: { id: b.failureReportId } });
        if (f.assetId !== b.assetId) throw new BadRequestException('El reporte de falla corresponde a otro activo');
        if (['CERRADA', 'ANULADA'].includes(f.status)) throw new ConflictException('El reporte de falla está cerrado o anulado');
      }
      const code = await this.counters.nextCode(tx, 'OT', currentYearBogota());
      const w = await tx.workOrder.create({
        data: {
          code, type: b.type, assetId: b.assetId, areaId: asset.areaId, title: b.title, description: b.description ?? null,
          priority: b.priority, status: b.assignedToId ? 'ASIGNADA' : 'ABIERTA', assignedToId: b.assignedToId ?? null,
          supplierId: b.supplierId ?? null, scheduledDate: b.scheduledDate ? parseYmd(b.scheduledDate) : null,
          dueDate: b.dueDate ? parseYmd(b.dueDate) : null, failureReportId: b.failureReportId ?? null,
          parentWorkOrderId: b.parentWorkOrderId ?? null, interventionType: b.interventionType ?? null, createdById: ctx.user.id,
          checklistResults: [],
        },
      });
      await this.event(tx, w.id, ctx.user.id, 'CREAR', null, w.status);
      if (b.failureReportId && b.assignedToId) {
        await tx.failureReport.updateMany({ where: { id: b.failureReportId, status: { in: ['REPORTADA', 'EN_EVALUACION'] } }, data: { status: 'ASIGNADA', assignedToId: b.assignedToId } });
      }
      await this.audit.log(ctx, { action: 'CREAR', module: 'ordenes', entity: 'WorkOrder', entityId: w.id, after: w }, tx);
      return w;
    };
    return tx0 ? run(tx0) : this.prisma.$transaction(run);
  }

  // ------------------------------------------------------------- Flujo
  async assign(ctx: ReqCtx, id: string, assignedToId: string, supplierId: string | null | undefined, note?: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const w = await this.loadForUpdate(tx, id);
      assertAreaAccess(ctx.user, w.areaId);
      if (['CERRADA', 'CANCELADA', 'PENDIENTE_VALIDACION'].includes(w.status)) throw new ConflictException(`No se puede reasignar una orden en estado ${w.status}`);
      const u = await tx.user.findUnique({ where: { id: assignedToId } });
      if (!u || !u.isActive) throw new BadRequestException('Usuario asignado inválido o inactivo');
      const to: WorkOrderStatus = w.status === 'ABIERTA' ? 'ASIGNADA' : w.status;
      const updated = await tx.workOrder.update({ where: { id }, data: { assignedToId, status: to, supplierId: supplierId === undefined ? undefined : supplierId } });
      await this.event(tx, id, ctx.user.id, w.assignedToId ? 'REASIGNAR' : 'ASIGNAR', w.status, to, note, { from: w.assignedToId, to: assignedToId });
      if (w.failureReportId) {
        await tx.failureReport.updateMany({ where: { id: w.failureReportId, status: { in: ['REPORTADA', 'EN_EVALUACION', 'ASIGNADA'] } }, data: { status: 'ASIGNADA', assignedToId, firstResponseAt: undefined } });
      }
      await this.audit.log(ctx, { action: w.assignedToId ? 'REASIGNAR' : 'ASIGNAR', module: 'ordenes', entity: 'WorkOrder', entityId: id, before: { assignedToId: w.assignedToId }, after: { assignedToId }, reason: note }, tx);
      return updated;
    });
  }

  async start(ctx: ReqCtx, id: string, startedAt?: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const w = await this.loadForUpdate(tx, id);
      this.assertExecutor(ctx, w);
      assertTransition(w.status, 'EN_EJECUCION');
      if (w.status !== 'ASIGNADA') throw new ConflictException('La orden debe estar asignada para iniciarla');
      const at = startedAt ? new Date(startedAt) : new Date();
      if (at > new Date(Date.now() + 5 * 60_000)) throw new BadRequestException('La fecha de inicio no puede ser futura');
      const updated = await tx.workOrder.update({ where: { id }, data: { status: 'EN_EJECUCION', startedAt: at } });
      await this.event(tx, id, ctx.user.id, 'INICIAR', w.status, 'EN_EJECUCION');
      if (w.activityId) await tx.scheduledActivity.update({ where: { id: w.activityId }, data: { status: 'EN_EJECUCION' } });
      if (w.type === 'CORRECTIVA') {
        if (!['FUERA_DE_SERVICIO', 'EN_MANTENIMIENTO'].includes(w.asset.status)) {
          await this.assets.changeStatus(ctx, w.assetId, 'EN_MANTENIMIENTO', `Inicio de orden correctiva ${w.code}`, null, tx);
        }
        if (w.failureReportId) {
          const f = await tx.failureReport.findUniqueOrThrow({ where: { id: w.failureReportId } });
          await tx.failureReport.update({ where: { id: f.id }, data: { status: 'EN_ATENCION', firstResponseAt: f.firstResponseAt ?? at } });
        }
      }
      await this.audit.log(ctx, { action: 'INICIAR', module: 'ordenes', entity: 'WorkOrder', entityId: id, after: { startedAt: at } }, tx);
      return updated;
    });
  }

  async pause(ctx: ReqCtx, id: string, status: 'PENDIENTE_REPUESTOS' | 'PENDIENTE_PROVEEDOR', reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const w = await this.loadForUpdate(tx, id);
      this.assertExecutor(ctx, w);
      assertTransition(w.status, status);
      const updated = await tx.workOrder.update({ where: { id }, data: { status, pauseReason: reason } });
      await this.event(tx, id, ctx.user.id, 'PAUSAR', w.status, status, reason);
      await this.audit.log(ctx, { action: 'PAUSAR', module: 'ordenes', entity: 'WorkOrder', entityId: id, before: { status: w.status }, after: { status }, reason }, tx);
      return updated;
    });
  }

  async resume(ctx: ReqCtx, id: string, note?: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const w = await this.loadForUpdate(tx, id);
      this.assertExecutor(ctx, w);
      if (!['PENDIENTE_REPUESTOS', 'PENDIENTE_PROVEEDOR'].includes(w.status)) throw new ConflictException('La orden no está en pausa');
      const updated = await tx.workOrder.update({ where: { id }, data: { status: 'EN_EJECUCION' } });
      await this.event(tx, id, ctx.user.id, 'REANUDAR', w.status, 'EN_EJECUCION', note);
      await this.audit.log(ctx, { action: 'REANUDAR', module: 'ordenes', entity: 'WorkOrder', entityId: id, before: { status: w.status }, after: { status: 'EN_EJECUCION' } }, tx);
      return updated;
    });
  }

  /** Registro de la ejecución (se puede guardar parcialmente mientras la orden está en ejecución o en pausa) */
  async saveExecution(ctx: ReqCtx, id: string, b: ExecutionInput) {
    return this.prisma.$transaction(async (tx) => {
      const w = await this.loadForUpdate(tx, id);
      this.assertExecutor(ctx, w);
      if (!['EN_EJECUCION', 'PENDIENTE_REPUESTOS', 'PENDIENTE_PROVEEDOR'].includes(w.status)) {
        throw new ConflictException('Solo se puede documentar la ejecución de órdenes en ejecución o en pausa');
      }
      if (b.checklistResults) {
        const base = (w.checklistResults as unknown as ChecklistResult[] | null) ?? [];
        const ids = new Set(base.map((i) => i.itemId));
        for (const r of b.checklistResults) if (base.length && !ids.has(r.itemId)) throw new BadRequestException(`Ítem de lista de chequeo desconocido: ${r.itemId}`);
        b.checklistResults = base.length
          ? base.map((i) => {
              const r = b.checklistResults!.find((x) => x.itemId === i.itemId);
              return r ? { ...i, result: r.result, note: r.note ?? null } : i;
            })
          : b.checklistResults;
      }
      const startedAt = b.startedAt ? new Date(b.startedAt) : undefined;
      const finishedAt = b.finishedAt ? new Date(b.finishedAt) : undefined;
      const st = startedAt ?? w.startedAt;
      if (finishedAt && st && finishedAt < st) throw new BadRequestException('La fecha de finalización no puede ser anterior a la de inicio');
      if (finishedAt && finishedAt > new Date(Date.now() + 5 * 60_000)) throw new BadRequestException('La fecha de finalización no puede ser futura');
      const labor = b.laborCost ?? toNum(w.laborCost);
      const external = b.externalCost ?? toNum(w.externalCost);
      const parts = w.parts.reduce((s, p) => s + toNum(p.totalCost), 0);
      const data: Prisma.WorkOrderUncheckedUpdateInput = {
        interventionType: b.interventionType, activitiesPerformed: b.activitiesPerformed, diagnosis: b.diagnosis,
        checklistResults: b.checklistResults as never, findings: b.findings, result: b.result, testsPerformed: b.testsPerformed,
        finalCondition: b.finalCondition, laborCost: b.laborCost, externalCost: b.externalCost, partsCost: parts,
        totalCost: labor + external + parts, startedAt, finishedAt,
      };
      const updated = await tx.workOrder.update({ where: { id }, data });
      const changed = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined).map(([k]) => [k, true]));
      await this.event(tx, id, ctx.user.id, 'REGISTRAR_EJECUCION', w.status, w.status, null, { campos: Object.keys(changed) });
      await this.audit.log(ctx, { action: 'REGISTRAR_EJECUCION', module: 'ordenes', entity: 'WorkOrder', entityId: id, after: b }, tx);
      return updated;
    });
  }

  async addPart(ctx: ReqCtx, id: string, p: { name: string; partNumber?: string | null; quantity: number; unitCost: number }) {
    return this.prisma.$transaction(async (tx) => {
      const w = await this.loadForUpdate(tx, id);
      this.assertExecutor(ctx, w);
      if (!['EN_EJECUCION', 'PENDIENTE_REPUESTOS', 'PENDIENTE_PROVEEDOR'].includes(w.status)) throw new ConflictException('La orden no admite registro de repuestos en su estado actual');
      const total = Math.round(p.quantity * p.unitCost * 100) / 100;
      const part = await tx.workOrderPart.create({ data: { workOrderId: id, name: p.name, partNumber: p.partNumber ?? null, quantity: p.quantity, unitCost: p.unitCost, totalCost: total } });
      await this.recalc(tx, id);
      await this.event(tx, id, ctx.user.id, 'REGISTRAR_REPUESTO', w.status, w.status, `${p.quantity} x ${p.name}`);
      await this.audit.log(ctx, { action: 'REGISTRAR_REPUESTO', module: 'ordenes', entity: 'WorkOrderPart', entityId: part.id, after: part }, tx);
      return part;
    });
  }

  async removePart(ctx: ReqCtx, id: string, partId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const w = await this.loadForUpdate(tx, id);
      this.assertExecutor(ctx, w);
      if (!['EN_EJECUCION', 'PENDIENTE_REPUESTOS', 'PENDIENTE_PROVEEDOR'].includes(w.status)) throw new ConflictException('La orden no admite cambios en su estado actual');
      const part = await tx.workOrderPart.findFirst({ where: { id: partId, workOrderId: id } });
      if (!part) throw new NotFoundException('Repuesto no encontrado');
      await tx.workOrderPart.delete({ where: { id: partId } });
      await this.recalc(tx, id);
      await this.event(tx, id, ctx.user.id, 'RETIRAR_REPUESTO', w.status, w.status, reason, part);
      await this.audit.log(ctx, { action: 'RETIRAR_REPUESTO', module: 'ordenes', entity: 'WorkOrderPart', entityId: partId, before: part, reason }, tx);
      return { ok: true };
    });
  }

  private async recalc(tx: Tx, id: string) {
    const w = await tx.workOrder.findUniqueOrThrow({ where: { id }, include: { parts: true } });
    const parts = w.parts.reduce((s, p) => s + toNum(p.totalCost), 0);
    await tx.workOrder.update({ where: { id }, data: { partsCost: parts, totalCost: toNum(w.laborCost) + toNum(w.externalCost) + parts } });
  }

  /** Campos obligatorios para solicitar validación */
  missingForValidation(w: { type: WorkOrderType; activitiesPerformed: string | null; finalCondition: FinalCondition | null; startedAt: Date | null; finishedAt: Date | null; checklistResults: unknown; result: string | null; findings: string | null; diagnosis: string | null; testsPerformed: string | null; supplierId: string | null }): string[] {
    const m: string[] = [];
    if (!w.startedAt) m.push('Fecha de inicio');
    if (!w.activitiesPerformed || w.activitiesPerformed.trim().length < 10) m.push('Actividades ejecutadas (mín. 10 caracteres)');
    if (!w.finalCondition) m.push('Condición final del activo');
    if (w.type === 'PREVENTIVA') {
      const cl = (w.checklistResults as ChecklistResult[] | null) ?? [];
      const pending = cl.filter((i) => i.required && !i.result);
      if (pending.length) m.push(`Lista de chequeo: ${pending.length} ítem(s) obligatorio(s) sin diligenciar`);
      if (!(w.result?.trim() || w.findings?.trim())) m.push('Resultado u hallazgos');
    } else {
      if (!w.diagnosis || w.diagnosis.trim().length < 10) m.push('Diagnóstico técnico (mín. 10 caracteres)');
      if (!w.testsPerformed || w.testsPerformed.trim().length < 5) m.push('Pruebas realizadas');
    }
    return m;
  }

  async submitForValidation(ctx: ReqCtx, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const w = await this.loadForUpdate(tx, id);
      this.assertExecutor(ctx, w);
      assertTransition(w.status, 'PENDIENTE_VALIDACION');
      const finishedAt = w.finishedAt ?? new Date();
      const missing = this.missingForValidation({ ...w, finishedAt });
      if (missing.length) throw new BadRequestException({ message: `Faltan campos obligatorios: ${missing.join('; ')}`, missing });
      if (w.startedAt && finishedAt < w.startedAt) throw new BadRequestException('La fecha de finalización es anterior al inicio');
      const updated = await tx.workOrder.update({ where: { id }, data: { status: 'PENDIENTE_VALIDACION', finishedAt } });
      await this.event(tx, id, ctx.user.id, 'SOLICITAR_VALIDACION', w.status, 'PENDIENTE_VALIDACION');
      await this.audit.log(ctx, { action: 'SOLICITAR_VALIDACION', module: 'ordenes', entity: 'WorkOrder', entityId: id }, tx);
      return updated;
    });
  }

  async rejectValidation(ctx: ReqCtx, id: string, note: string) {
    return this.prisma.$transaction(async (tx) => {
      const w = await this.loadForUpdate(tx, id);
      assertAreaAccess(ctx.user, w.areaId);
      if (w.status !== 'PENDIENTE_VALIDACION') throw new ConflictException('La orden no está pendiente de validación');
      const updated = await tx.workOrder.update({ where: { id }, data: { status: 'EN_EJECUCION' } });
      await this.event(tx, id, ctx.user.id, 'DEVOLVER', w.status, 'EN_EJECUCION', note);
      await this.audit.log(ctx, { action: 'DEVOLVER_VALIDACION', module: 'ordenes', entity: 'WorkOrder', entityId: id, reason: note }, tx);
      return updated;
    });
  }

  /**
   * Validación técnica y cierre. Efectos (en una sola transacción):
   * - Actividad preventiva vinculada → EJECUTADO con su fecha real (se conservan fecha original y comprometida).
   * - Estado del activo según la condición final (historial de estados).
   * - Falla vinculada → RESUELTA, con autorización de liberación del activo y fin de indisponibilidad.
   * - Activo CRÍTICO: solo personal con competencia técnica certificada y permiso failures.release puede declararlo reparado.
   * Una orden correctiva NO marca como cumplida ninguna actividad preventiva independiente.
   */
  async close(ctx: ReqCtx, id: string, b: { verificationNote: string; validatorSignature: string }) {
    return this.prisma.$transaction(async (tx) => {
      const w = await this.loadForUpdate(tx, id);
      assertAreaAccess(ctx.user, w.areaId);
      assertTransition(w.status, 'CERRADA');
      const allowSelf = await this.settings.get<boolean>('workorders.allowSelfVerification');
      if (!allowSelf && w.assignedToId === ctx.user.id) throw new ForbiddenException('Quien ejecutó la orden no puede validarla (segregación de funciones)');
      const missing = this.missingForValidation(w);
      if (missing.length) throw new BadRequestException({ message: `Faltan campos obligatorios: ${missing.join('; ')}`, missing });
      const restoresOperation = w.finalCondition === 'OPERATIVO' || w.finalCondition === 'OPERATIVO_CON_OBSERVACIONES';
      if (w.asset.criticality === 'CRITICA' && restoresOperation) {
        if (!ctx.user.isTechnicalStaff || !can(ctx.user, 'failures.release')) {
          throw new ForbiddenException('El activo es CRÍTICO: solo un responsable técnico autorizado (competencia técnica + permiso de liberación) puede declararlo reparado y liberarlo');
        }
      }
      const now = new Date();
      await this.recalc(tx, id);
      const updated = await tx.workOrder.update({
        where: { id },
        data: { status: 'CERRADA', verifiedById: ctx.user.id, verifiedAt: now, verificationNote: b.verificationNote, validatorSignature: b.validatorSignature, closedAt: now },
      });
      await this.event(tx, id, ctx.user.id, 'VALIDAR_Y_CERRAR', w.status, 'CERRADA', b.verificationNote);

      // Actividad preventiva
      if (w.activityId && w.type === 'PREVENTIVA') {
        const execDate = instantToBogotaDate(w.finishedAt ?? now);
        await tx.scheduledActivity.update({ where: { id: w.activityId }, data: { status: 'EJECUTADO', executedDate: parseYmd(execDate) } });
        const act = await tx.scheduledActivity.findUniqueOrThrow({ where: { id: w.activityId } });
        const prog = await tx.maintenanceProgram.findUniqueOrThrow({ where: { id: act.programId } });
        if (!prog.lastPerformedDate || fmtYmd(prog.lastPerformedDate) < execDate) {
          await tx.maintenanceProgram.update({ where: { id: prog.id }, data: { lastPerformedDate: parseYmd(execDate) } });
        }
      }
      // Estado del activo
      if (w.finalCondition) {
        const target = FINAL_TO_ASSET[w.finalCondition];
        const current = (await tx.asset.findUniqueOrThrow({ where: { id: w.assetId } })).status;
        if (current !== target && !INACTIVE_STATUSES.includes(current)) {
          await this.assets.changeStatus(ctx, w.assetId, target, `Cierre de ${w.code}: condición final ${w.finalCondition}`, null, tx);
        }
      }
      // Falla vinculada
      if (w.failureReportId) {
        const f = await tx.failureReport.findUniqueOrThrow({ where: { id: w.failureReportId } });
        if (!['CERRADA', 'ANULADA', 'RESUELTA'].includes(f.status)) {
          await tx.failureReport.update({
            where: { id: f.id },
            data: {
              status: 'RESUELTA', resolvedAt: w.finishedAt ?? now, resolvedByWorkOrderId: w.id,
              downtimeEnd: f.downtimeStart && !f.downtimeEnd && restoresOperation ? now : undefined,
              releaseAuthorizedById: restoresOperation ? ctx.user.id : undefined,
              releaseAuthorizedAt: restoresOperation ? now : undefined,
              releaseNote: restoresOperation ? b.verificationNote : undefined,
              firstResponseAt: f.firstResponseAt ?? w.startedAt ?? undefined,
            },
          });
        }
      }
      await this.audit.log(ctx, { action: 'CERRAR', module: 'ordenes', entity: 'WorkOrder', entityId: id, before: { status: w.status }, after: { status: 'CERRADA', finalCondition: w.finalCondition, totalCost: updated.totalCost }, reason: b.verificationNote }, tx);
      return updated;
    });
  }

  async cancel(ctx: ReqCtx, id: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const w = await this.loadForUpdate(tx, id);
      assertAreaAccess(ctx.user, w.areaId);
      assertTransition(w.status, 'CANCELADA');
      // Se libera el vínculo con la actividad (queda registrado en el historial) para permitir una nueva orden
      const updated = await tx.workOrder.update({ where: { id }, data: { status: 'CANCELADA', cancelReason: reason, closedAt: new Date(), activityId: null } });
      await this.event(tx, id, ctx.user.id, 'CANCELAR', w.status, 'CANCELADA', reason, w.activityId ? { actividadDesvinculada: w.activityId } : undefined);
      if (w.activityId && w.activity && w.activity.status === 'EN_EJECUCION') {
        const back = fmtYmd(w.activity.originalDate) !== fmtYmd(w.activity.committedDate) ? 'REPROGRAMADO' : 'PROGRAMADO';
        await tx.scheduledActivity.update({ where: { id: w.activityId }, data: { status: back } });
      }
      if (w.failureReportId) {
        const others = await tx.workOrder.count({ where: { failureReportId: w.failureReportId, id: { not: id }, status: { in: ACTIVE } } });
        if (!others) await tx.failureReport.updateMany({ where: { id: w.failureReportId, status: { in: ['ASIGNADA', 'EN_ATENCION'] } }, data: { status: 'EN_EVALUACION' } });
      }
      await this.audit.log(ctx, { action: 'CANCELAR', module: 'ordenes', entity: 'WorkOrder', entityId: id, before: { status: w.status }, after: { status: 'CANCELADA' }, reason }, tx);
      return updated;
    });
  }
}
