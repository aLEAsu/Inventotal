import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit.service';
import type { ReqCtx } from '../../common/auth.types';
import { addDays, currentYearBogota, fmtYmd, parseYmd, todayBogota } from '../../common/dates';
import { PrismaService, Tx } from '../../common/prisma.service';
import { areaFilter, assertAreaAccess, can } from '../../common/scope';
import { SettingsService } from '../../common/settings.service';
import type { ActivityStatus, PlanStatus, Prisma } from '../../generated/prisma/client';
import { INACTIVE_STATUSES } from '../assets/assets.service';
import { describeRule, occurrencesInYear } from './recurrence';

export type DisplayStatus = ActivityStatus | 'PROXIMO' | 'VENCIDO';

export const DISPLAY_STATUS_LABELS: Record<DisplayStatus, string> = {
  PROGRAMADO: 'Programado', PROXIMO: 'Próximo', EN_EJECUCION: 'En ejecución', EJECUTADO: 'Ejecutado',
  VENCIDO: 'Vencido', REPROGRAMADO: 'Reprogramado', CANCELADO: 'Cancelado', NO_APLICA: 'No aplica',
};

/** Estado visible de una actividad, calculado con la fecha actual de Bogotá. */
export function displayStatus(a: { status: ActivityStatus; committedDate: Date | string }, today: string, upcomingDays: number): DisplayStatus {
  if (a.status !== 'PROGRAMADO' && a.status !== 'REPROGRAMADO') return a.status;
  const d = typeof a.committedDate === 'string' ? a.committedDate : fmtYmd(a.committedDate);
  if (d < today) return 'VENCIDO';
  if (d <= addDays(today, upcomingDays)) return 'PROXIMO';
  return a.status;
}

export interface ActivityFilters {
  month?: number;
  areaId?: string;
  categoryId?: string;
  assetId?: string;
  responsibleId?: string;
  criticality?: 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAJA';
  status?: DisplayStatus;
  kind?: string;
  q?: string;
  /** Cronograma preventivo (todos los tipos excepto correctivo) o correctivo */
  scheduleType?: ScheduleType;
}

export type ScheduleType = 'PREVENTIVO' | 'CORRECTIVO';
export type MatrixView = 'grupos' | 'equipos';

/** Filtro de programas según el cronograma solicitado */
export function scheduleKindWhere(scheduleType?: ScheduleType | null): Prisma.MaintenanceProgramWhereInput {
  if (scheduleType === 'CORRECTIVO') return { kind: 'CORRECTIVO' };
  if (scheduleType === 'PREVENTIVO') return { kind: { not: 'CORRECTIVO' } };
  return {};
}

export const SCHEDULE_TYPE_LABEL: Record<ScheduleType, string> = { PREVENTIVO: 'Preventivo', CORRECTIVO: 'Correctivo' };

/** Prioridad para resumir el estado de varias actividades en una celda agrupada (la más urgente primero) */
const STATUS_PRIORITY: DisplayStatus[] = ['VENCIDO', 'PROXIMO', 'EN_EJECUCION', 'REPROGRAMADO', 'PROGRAMADO', 'EJECUTADO', 'CANCELADO', 'NO_APLICA'];
export function summarizeStatus(statuses: DisplayStatus[]): DisplayStatus {
  const active = statuses.filter((x) => x !== 'CANCELADO' && x !== 'NO_APLICA');
  const pool = active.length ? active : statuses;
  return STATUS_PRIORITY.find((x) => pool.includes(x)) ?? statuses[0];
}

const EXCLUDED_PREFIX = 'Excluida en regeneración';

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  currentYear() {
    return { year: currentYearBogota(), today: todayBogota(), timezone: 'America/Bogota' };
  }

  async listPlans() {
    const plans = await this.prisma.annualPlan.findMany({ orderBy: { year: 'desc' } });
    const counts = await this.prisma.scheduledActivity.groupBy({ by: ['planId', 'status'], _count: true });
    return plans.map((p) => {
      const c = counts.filter((x) => x.planId === p.id);
      return {
        ...p,
        totalActivities: c.reduce((s, x) => s + x._count, 0),
        executed: c.find((x) => x.status === 'EJECUTADO')?._count ?? 0,
      };
    });
  }

  async getPlan(year: number) {
    const p = await this.prisma.annualPlan.findUnique({ where: { year } });
    if (!p) return null;
    const users = await this.userNames([p.createdById, p.submittedById, p.reviewedById, p.approvedById, p.closedById]);
    const pendingReschedules = await this.prisma.reschedule.count({ where: { status: 'PENDIENTE', activity: { planId: p.id } } });
    return {
      ...p,
      createdBy: users.get(p.createdById) ?? null,
      submittedBy: p.submittedById ? users.get(p.submittedById) : null,
      reviewedBy: p.reviewedById ? users.get(p.reviewedById) : null,
      approvedBy: p.approvedById ? users.get(p.approvedById) : null,
      closedBy: p.closedById ? users.get(p.closedById) : null,
      pendingReschedules,
    };
  }

  async requirePlan(year: number, tx: Tx = this.prisma) {
    const p = await tx.annualPlan.findUnique({ where: { year } });
    if (!p) throw new NotFoundException(`No existe plan anual para ${year}`);
    return p;
  }

  async createPlan(ctx: ReqCtx, year: number, notes?: string | null) {
    this.validateYear(year);
    return this.prisma.$transaction(async (tx) => {
      const exists = await tx.annualPlan.findUnique({ where: { year } });
      if (exists) throw new ConflictException(`Ya existe un plan anual para ${year} (estado: ${exists.status})`);
      const prefix = await this.settings.get<string>('plan.documentCodePrefix');
      const p = await tx.annualPlan.create({
        data: { year, documentCode: `${prefix}-${year}`, notes: notes ?? null, createdById: ctx.user.id },
      });
      await tx.annualPlanEvent.create({ data: { planId: p.id, action: 'CREAR', toStatus: 'BORRADOR', version: 1, userId: ctx.user.id } });
      await this.audit.log(ctx, { action: 'CREAR', module: 'cronograma', entity: 'AnnualPlan', entityId: p.id, after: p }, tx);
      return p;
    });
  }

  /**
   * Generación del cronograma (transaccional e idempotente).
   * - BORRADOR / EN_REVISION(no): crea las actividades faltantes, excluye las que ya no corresponden
   *   (programa modificado/inactivo, activo retirado) marcándolas NO_APLICA (no se borran) y reactiva las que vuelven a aplicar.
   * - APROBADO: solo agrega actividades de programas que no tienen actividades en el plan (p. ej. activos nuevos),
   *   marcadas como "agregadas después de aprobación"; exige justificación e incrementa la versión.
   * - CERRADO: no se permite.
   */
  async generate(ctx: ReqCtx, year: number, reason?: string | null, scheduleType: ScheduleType | null = null) {
    this.validateYear(year);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'sigm-plan-gen-' + year}))`;
        const plan = await this.requirePlan(year, tx);
        if (plan.status === 'CERRADO') throw new ConflictException('El plan está cerrado; no admite cambios');
        if (plan.status === 'EN_REVISION') throw new ConflictException('El plan está en revisión. Devuélvalo a borrador para regenerarlo.');
        const approved = plan.status === 'APROBADO';
        if (approved && (!reason || reason.trim().length < 10)) {
          throw new BadRequestException('El plan está aprobado: indique la justificación para agregar actividades (mín. 10 caracteres)');
        }

        const yStart = parseYmd(`${year}-01-01`);
        const yEnd = parseYmd(`${year}-12-31`);
        const programs = await tx.maintenanceProgram.findMany({
          where: {
            ...scheduleKindWhere(scheduleType),
            isActive: true,
            startDate: { lte: yEnd },
            OR: [{ endDate: null }, { endDate: { gte: yStart } }],
          },
          include: {
            asset: { select: { id: true, status: true } },
            category: { select: { id: true, name: true } },
            subcategory: { select: { id: true, name: true } },
            group: { select: { id: true, name: true, isActive: true, assets: { select: { assetId: true } } } },
            supplier: { select: { name: true } },
          },
        });
        const targetClauses: Prisma.AssetWhereInput[] = [];
        for (const p of programs) {
          if (p.targetType === 'ACTIVO' && p.assetId) targetClauses.push({ id: p.assetId });
          if (p.targetType === 'CATEGORIA' && p.categoryId) targetClauses.push({ categoryId: p.categoryId });
          if (p.targetType === 'SUBCATEGORIA' && p.subcategoryId) targetClauses.push({ subcategoryId: p.subcategoryId });
          if (p.targetType === 'GRUPO' && p.group?.isActive && p.group.assets.length) {
            targetClauses.push({ id: { in: p.group.assets.map((m) => m.assetId) } });
          }
        }
        const targetAssets = targetClauses.length
          ? await tx.asset.findMany({
              where: { status: { notIn: INACTIVE_STATUSES }, OR: targetClauses },
              include: { area: true, category: true },
            })
          : [];
        const assetsByProgram = new Map(programs.map((p) => {
          let matches = targetAssets;
          if (p.targetType === 'ACTIVO') matches = targetAssets.filter((a) => a.id === p.assetId);
          if (p.targetType === 'CATEGORIA') matches = targetAssets.filter((a) => a.categoryId === p.categoryId);
          if (p.targetType === 'SUBCATEGORIA') matches = targetAssets.filter((a) => a.subcategoryId === p.subcategoryId);
          if (p.targetType === 'GRUPO') {
            const ids = new Set(p.group?.isActive ? p.group.assets.map((m) => m.assetId) : []);
            matches = targetAssets.filter((a) => ids.has(a.id));
          }
          return [p.id, matches];
        }));
        const evaluatedPrograms = programs.filter((p) => (assetsByProgram.get(p.id)?.length ?? 0) > 0);
        let eligibilityDiagnostics: {
          totalPrograms: number;
          inactivePrograms: number;
          inactiveAssets: number;
          startsAfterYear: number;
          expiredBeforeYear: number;
          noEligibleAssets: number;
          eligiblePrograms: number;
        } | null = null;
        if (!evaluatedPrograms.length) {
          const allPrograms = await tx.maintenanceProgram.findMany({
            where: scheduleKindWhere(scheduleType),
            select: { id: true, isActive: true, startDate: true, endDate: true, targetType: true, asset: { select: { status: true } } },
          });
          eligibilityDiagnostics = {
            totalPrograms: allPrograms.length,
            inactivePrograms: 0,
            inactiveAssets: 0,
            startsAfterYear: 0,
            expiredBeforeYear: 0,
            noEligibleAssets: 0,
            eligiblePrograms: 0,
          };
          for (const p of allPrograms) {
            if (!p.isActive) eligibilityDiagnostics.inactivePrograms++;
            else if (p.startDate > yEnd) eligibilityDiagnostics.startsAfterYear++;
            else if (p.endDate && p.endDate < yStart) eligibilityDiagnostics.expiredBeforeYear++;
            else if (!assetsByProgram.get(p.id)?.length) {
              if (p.targetType === 'ACTIVO' && p.asset && INACTIVE_STATUSES.includes(p.asset.status)) eligibilityDiagnostics.inactiveAssets++;
              else eligibilityDiagnostics.noEligibleAssets++;
            } else eligibilityDiagnostics.eligiblePrograms++;
          }
        }
        // Solo se comparan las actividades del cronograma que se está generando (preventivo / correctivo)
        const existing = await tx.scheduledActivity.findMany({
          where: { planId: plan.id, program: scheduleKindWhere(scheduleType) },
          select: { id: true, programId: true, assetId: true, periodKey: true, status: true, statusReason: true, workOrder: { select: { id: true } } },
        });
        const existingKey = new Map(existing.map((e) => [`${e.programId}|${e.assetId}|${e.periodKey}`, e]));
        const assetsWithActs = new Set(existing.map((e) => `${e.programId}|${e.assetId}`));

        const toCreate: Prisma.ScheduledActivityCreateManyInput[] = [];
        const desired = new Set<string>();
        const errors: { program: string; error: string }[] = [];
        const byCategory: Record<string, number> = {};
        const byMonth: number[] = Array(12).fill(0);
        let skippedExisting = 0;

        for (const p of evaluatedPrograms) {
          let dates: string[];
          try {
            dates = occurrencesInYear(
              {
                frequencyType: p.frequencyType, intervalValue: p.intervalValue, intervalUnit: p.intervalUnit,
                specificDates: p.specificDates, startDate: fmtYmd(p.startDate), baseDate: fmtYmd(p.baseDate),
                endDate: p.endDate ? fmtYmd(p.endDate) : null, monthsOfYear: p.monthsOfYear,
                weekOfMonth: p.weekOfMonth, dayOfWeek: p.dayOfWeek,
              },
              year,
            );
          } catch (e) {
            errors.push({ program: p.code, error: (e as Error).message });
            continue;
          }
          const targetName = p.targetType === 'ACTIVO' ? p.name
            : p.targetType === 'CATEGORIA' ? p.category?.name
              : p.targetType === 'SUBCATEGORIA' ? p.subcategory?.name : p.group?.name;
          for (const asset of assetsByProgram.get(p.id) ?? []) {
            if (approved && assetsWithActs.has(`${p.id}|${asset.id}`)) continue;
            const decommission = asset.decommissionedAt ? fmtYmd(asset.decommissionedAt) : null;
            const snapshot = {
              programCode: p.code, programName: p.name, kind: p.kind, frequencyType: p.frequencyType,
              frequencyLabel: describeRule(p), programVersion: p.version, assetCode: asset.code, assetName: asset.name,
              areaName: asset.area.name, categoryName: asset.category.name, supplierName: p.supplier?.name ?? null,
              targetType: p.targetType, targetName: targetName ?? null, displayMode: p.displayMode,
              estimatedDurationMin: p.estimatedDurationMin,
            };
            for (const date of dates) {
              if (decommission && date >= decommission) continue;
              const key = `${p.id}|${asset.id}|${date}`;
              desired.add(key);
              if (existingKey.has(key)) {
                skippedExisting++;
                continue;
              }
              toCreate.push({
                planId: plan.id, programId: p.id, assetId: asset.id, periodKey: date,
                originalDate: parseYmd(date), committedDate: parseYmd(date), status: 'PROGRAMADO',
                responsibleId: p.responsibleId, addedAfterApproval: approved, programSnapshot: snapshot,
              });
              byCategory[asset.category.name] = (byCategory[asset.category.name] ?? 0) + 1;
              byMonth[Number(date.slice(5, 7)) - 1]++;
            }
          }
        }

        let created = 0;
        if (toCreate.length) {
          const r = await tx.scheduledActivity.createMany({ data: toCreate, skipDuplicates: true });
          created = r.count;
        }

        let excluded = 0;
        let reactivated = 0;
        if (!approved) {
          const obsolete = existing.filter(
            (e) => !desired.has(`${e.programId}|${e.assetId}|${e.periodKey}`) && (e.status === 'PROGRAMADO' || e.status === 'REPROGRAMADO') && !e.workOrder,
          );
          if (obsolete.length) {
            const r = await tx.scheduledActivity.updateMany({
              where: { id: { in: obsolete.map((o) => o.id) } },
              data: { status: 'NO_APLICA', statusReason: `${EXCLUDED_PREFIX}: el programa o el activo ya no generan esta fecha` },
            });
            excluded = r.count;
          }
          const back = existing.filter(
            (e) => desired.has(`${e.programId}|${e.assetId}|${e.periodKey}`) && e.status === 'NO_APLICA' && e.statusReason?.startsWith(EXCLUDED_PREFIX),
          );
          if (back.length) {
            const r = await tx.scheduledActivity.updateMany({
              where: { id: { in: back.map((o) => o.id) } },
              data: { status: 'PROGRAMADO', statusReason: null },
            });
            reactivated = r.count;
          }
        }

        const newVersion = approved && created > 0 ? plan.version + 1 : plan.version;
        await tx.annualPlan.update({ where: { id: plan.id }, data: { lastGeneratedAt: new Date(), version: newVersion } });
        const detail = { scheduleType, created, skippedExisting, excluded, reactivated, programsEvaluated: evaluatedPrograms.length, eligibilityDiagnostics, byCategory, byMonth, errors };
        await tx.annualPlanEvent.create({
          data: { planId: plan.id, action: approved ? 'AGREGAR_ACTIVIDADES' : 'GENERAR', version: newVersion, detail, reason: reason ?? null, userId: ctx.user.id },
        });
        if (approved && created > 0) await this.snapshotVersion(tx, plan.id, newVersion, ctx.user.id, reason ?? null);
        await this.audit.log(ctx, { action: 'GENERAR_CRONOGRAMA', module: 'cronograma', entity: 'AnnualPlan', entityId: plan.id, after: detail, reason }, tx);
        return { year, planStatus: plan.status, version: newVersion, ...detail };
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }

  // -------------------------------------------------------------- Flujo documental
  async transition(ctx: ReqCtx, year: number, action: 'SUBMIT' | 'RETURN' | 'APPROVE' | 'CLOSE' | 'REVIEW', reason?: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const p = await this.requirePlan(year, tx);
      const rules: Record<typeof action, { from: PlanStatus[]; to: PlanStatus; perm: string }> = {
        SUBMIT: { from: ['BORRADOR'], to: 'EN_REVISION', perm: 'plans.submit' },
        REVIEW: { from: ['EN_REVISION'], to: 'EN_REVISION', perm: 'plans.approve' },
        RETURN: { from: ['EN_REVISION'], to: 'BORRADOR', perm: 'plans.approve' },
        APPROVE: { from: ['EN_REVISION'], to: 'APROBADO', perm: 'plans.approve' },
        CLOSE: { from: ['APROBADO'], to: 'CERRADO', perm: 'plans.close' },
      };
      const r = rules[action];
      if (!can(ctx.user, r.perm)) throw new ForbiddenException(`Requiere el permiso ${r.perm}`);
      if (!r.from.includes(p.status)) throw new ConflictException(`Acción no permitida en estado ${p.status}`);
      if ((action === 'RETURN' || action === 'CLOSE') && (!reason || reason.trim().length < 10)) {
        throw new BadRequestException('Indique la justificación (mínimo 10 caracteres)');
      }
      const count = await tx.scheduledActivity.count({ where: { planId: p.id } });
      if (action === 'SUBMIT' && count === 0) throw new ConflictException('El plan no tiene actividades. Genere el cronograma antes de enviarlo a revisión.');
      if (action === 'CLOSE') {
        const pending = await tx.reschedule.count({ where: { status: 'PENDIENTE', activity: { planId: p.id } } });
        if (pending) throw new ConflictException(`Hay ${pending} reprogramaciones pendientes de decisión`);
      }
      const now = new Date();
      const data: Prisma.AnnualPlanUpdateInput = { status: r.to };
      if (action === 'SUBMIT') Object.assign(data, { submittedById: ctx.user.id, submittedAt: now });
      if (action === 'REVIEW') Object.assign(data, { reviewedById: ctx.user.id, reviewedAt: now });
      if (action === 'APPROVE') {
        Object.assign(data, { approvedById: ctx.user.id, approvedAt: now });
        if (!p.reviewedById) Object.assign(data, { reviewedById: ctx.user.id, reviewedAt: now });
      }
      if (action === 'CLOSE') Object.assign(data, { closedById: ctx.user.id, closedAt: now });
      const updated = await tx.annualPlan.update({ where: { id: p.id }, data });
      if (action === 'APPROVE') {
        // La línea base aprobada: originalDate queda protegida por trigger desde este momento.
        await tx.scheduledActivity.updateMany({ where: { planId: p.id }, data: { addedAfterApproval: false } });
        await this.snapshotVersion(tx, p.id, p.version, ctx.user.id, reason ?? 'Aprobación del plan');
      }
      await tx.annualPlanEvent.create({
        data: { planId: p.id, action, fromStatus: p.status, toStatus: r.to, version: updated.version, reason: reason ?? null, userId: ctx.user.id },
      });
      await this.audit.log(ctx, { action: `PLAN_${action}`, module: 'cronograma', entity: 'AnnualPlan', entityId: p.id, before: { status: p.status }, after: { status: r.to, version: updated.version }, reason }, tx);
      return updated;
    });
  }

  private async snapshotVersion(tx: Tx, planId: string, version: number, userId: string, reason: string | null) {
    const acts = await tx.scheduledActivity.findMany({
      where: { planId },
      select: { id: true, periodKey: true, originalDate: true, committedDate: true, status: true, programSnapshot: true, addedAfterApproval: true },
      orderBy: [{ originalDate: 'asc' }],
    });
    const snapshot = acts.map((a) => {
      const s = a.programSnapshot as Record<string, unknown>;
      return {
        id: a.id, programCode: s.programCode, assetCode: s.assetCode, name: s.programName,
        originalDate: fmtYmd(a.originalDate), committedDate: fmtYmd(a.committedDate), status: a.status, addedAfterApproval: a.addedAfterApproval,
      };
    });
    const existing = await tx.annualPlanVersion.findUnique({ where: { planId_version: { planId, version } } });
    if (existing) return existing;
    return tx.annualPlanVersion.create({
      data: { planId, version, approvedById: userId, approvedAt: new Date(), activityCount: acts.length, snapshot: snapshot as never, reason },
    });
  }

  private async bumpVersionIfApproved(tx: Tx, planId: string, userId: string, action: string, detail: unknown, reason: string) {
    const p = await tx.annualPlan.findUniqueOrThrow({ where: { id: planId } });
    if (p.status === 'CERRADO') throw new ConflictException('El plan está cerrado; no admite cambios');
    if (p.status !== 'APROBADO') {
      await tx.annualPlanEvent.create({ data: { planId, action, version: p.version, detail: detail as never, reason, userId } });
      return p.version;
    }
    const v = p.version + 1;
    await tx.annualPlan.update({ where: { id: planId }, data: { version: v } });
    await tx.annualPlanEvent.create({ data: { planId, action, version: v, detail: detail as never, reason, userId } });
    await this.snapshotVersion(tx, planId, v, userId, reason);
    return v;
  }

  // -------------------------------------------------------------- Consultas
  private async activityWhere(ctx: ReqCtx, planId: string, f: ActivityFilters): Promise<Prisma.ScheduledActivityWhereInput> {
    const today = todayBogota();
    const upcoming = await this.settings.get<number>('schedule.upcomingDays');
    const year = (await this.prisma.annualPlan.findUniqueOrThrow({ where: { id: planId } })).year;
    const where: Prisma.ScheduledActivityWhereInput = {
      planId,
      asset: {
        ...areaFilter(ctx.user),
        ...(f.areaId ? { areaId: f.areaId } : {}),
        ...(f.categoryId ? { categoryId: f.categoryId } : {}),
        ...(f.criticality ? { criticality: f.criticality } : {}),
      },
      ...(f.assetId ? { assetId: f.assetId } : {}),
      ...(f.responsibleId ? { responsibleId: f.responsibleId } : {}),
      program: { AND: [f.kind ? { kind: f.kind as never } : {}, scheduleKindWhere(f.scheduleType)] },
    };
    if (f.month) {
      const m = String(f.month).padStart(2, '0');
      const start = `${year}-${m}-01`;
      where.committedDate = { gte: parseYmd(start), lt: parseYmd(f.month === 12 ? `${year + 1}-01-01` : `${year}-${String(f.month + 1).padStart(2, '0')}-01`) };
    }
    if (f.status) {
      const limit = parseYmd(addDays(today, upcoming));
      const t = parseYmd(today);
      const and: Prisma.ScheduledActivityWhereInput[] = [];
      switch (f.status) {
        case 'VENCIDO': and.push({ status: { in: ['PROGRAMADO', 'REPROGRAMADO'] }, committedDate: { lt: t } }); break;
        case 'PROXIMO': and.push({ status: { in: ['PROGRAMADO', 'REPROGRAMADO'] }, committedDate: { gte: t, lte: limit } }); break;
        case 'PROGRAMADO': and.push({ status: 'PROGRAMADO', committedDate: { gt: limit } }); break;
        case 'REPROGRAMADO': and.push({ status: 'REPROGRAMADO', committedDate: { gt: limit } }); break;
        default: and.push({ status: f.status });
      }
      where.AND = and;
    }
    if (f.q) {
      where.OR = [
        { asset: { code: { contains: f.q, mode: 'insensitive' } } },
        { asset: { name: { contains: f.q, mode: 'insensitive' } } },
        { program: { name: { contains: f.q, mode: 'insensitive' } } },
        { program: { code: { contains: f.q, mode: 'insensitive' } } },
      ];
    }
    return where;
  }

  async activities(ctx: ReqCtx, year: number, f: ActivityFilters, page = 1, pageSize = 100, sort = 'committedDate', dir: 'asc' | 'desc' = 'asc') {
    const plan = await this.requirePlan(year);
    const where = await this.activityWhere(ctx, plan.id, f);
    const today = todayBogota();
    const upcoming = await this.settings.get<number>('schedule.upcomingDays');
    const orderBy: Prisma.ScheduledActivityOrderByWithRelationInput[] =
      sort === 'asset' ? [{ asset: { code: dir } }, { committedDate: 'asc' }]
        : sort === 'area' ? [{ asset: { area: { name: dir } } }, { committedDate: 'asc' }]
          : sort === 'responsible' ? [{ responsible: { fullName: dir } }, { committedDate: 'asc' }]
            : [{ committedDate: dir }, { asset: { code: 'asc' } }];
    const [rows, total] = await Promise.all([
      this.prisma.scheduledActivity.findMany({
        where,
        include: {
          asset: { select: { id: true, code: true, name: true, criticality: true, status: true, area: { select: { id: true, name: true } }, category: { select: { id: true, name: true, color: true } } } },
          program: { select: { id: true, code: true, name: true, kind: true } },
          responsible: { select: { id: true, fullName: true } },
          workOrder: { select: { id: true, code: true, status: true } },
          reschedules: { where: { status: 'PENDIENTE' }, select: { id: true, toDate: true } },
        },
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.scheduledActivity.count({ where }),
    ]);
    return {
      planId: plan.id, planStatus: plan.status, version: plan.version, total, today,
      items: rows.map((a) => this.presentActivity(a, today, upcoming)),
    };
  }

  presentActivity<T extends { status: ActivityStatus; committedDate: Date; originalDate: Date; executedDate: Date | null }>(a: T, today: string, upcoming: number) {
    const ds = displayStatus(a, today, upcoming);
    return {
      ...a,
      originalDate: fmtYmd(a.originalDate),
      committedDate: fmtYmd(a.committedDate),
      executedDate: a.executedDate ? fmtYmd(a.executedDate) : null,
      displayStatus: ds,
      displayStatusLabel: DISPLAY_STATUS_LABELS[ds],
      rescheduled: fmtYmd(a.originalDate) !== fmtYmd(a.committedDate),
    };
  }

  /** Todas las actividades filtradas (para matriz y exportaciones) */
  async allActivities(ctx: ReqCtx, year: number, f: ActivityFilters) {
    const plan = await this.requirePlan(year);
    const where = await this.activityWhere(ctx, plan.id, f);
    const today = todayBogota();
    const upcoming = await this.settings.get<number>('schedule.upcomingDays');
    const rows = await this.prisma.scheduledActivity.findMany({
      where,
      include: {
        asset: { select: { id: true, code: true, name: true, criticality: true, area: { select: { id: true, name: true } }, category: { select: { id: true, name: true } }, subcategory: { select: { id: true, name: true } }, location: { select: { name: true } } } },
        program: { select: { id: true, code: true, name: true, kind: true, targetType: true, frequencyType: true, intervalValue: true, intervalUnit: true, specificDates: true, displayMode: true, group: { select: { name: true } }, category: { select: { name: true } }, subcategory: { select: { name: true } } } },
        responsible: { select: { id: true, fullName: true } },
        workOrder: { select: { code: true } },
      },
      orderBy: [{ asset: { category: { name: 'asc' } } }, { asset: { code: 'asc' } }, { program: { code: 'asc' } }, { committedDate: 'asc' }],
    });
    return { plan, today, items: rows.map((a) => this.presentActivity(a, today, upcoming)) };
  }

  /**
   * Vista matricial del cronograma (12 meses).
   * - view = 'grupos' (predeterminada): una fila por grupo de mantenimiento. Los programas por categoría,
   *   subcategoría o agrupación personalizada forman su propio grupo; los programas por activo individual se
   *   consolidan por subcategoría (o categoría), tipo y periodicidad. Cada celda resume los equipos de esa fecha.
   * - view = 'equipos': una fila por equipo y programa (detalle completo).
   * Las actividades, órdenes y el seguimiento se conservan siempre por equipo.
   */
  async matrix(ctx: ReqCtx, year: number, f: ActivityFilters, view: MatrixView = 'grupos') {
    const { plan, items, today } = await this.allActivities(ctx, year, { ...f, month: undefined });
    type Item = (typeof items)[number];
    type MatrixActivity = { id: string; assetId: string; assetCode: string; assetName: string; status: DisplayStatus; rescheduled: boolean; originalDate: string };
    type MatrixCell = {
      id: string; day: number; date: string; status: DisplayStatus; mixed: boolean; rescheduled: boolean; originalDate: string;
      count: number; executed: number; activities: MatrixActivity[];
    };
    type MatrixRow = {
      rowId: string; programId: string; programCode: string; programName: string; kind: string; targetName: string; groupType: string;
      grouped: boolean; assetId: string | null; assetCode: string; assetName: string; assetCount: number; areaName: string; categoryName: string;
      criticality: string; frequency: string; responsible: string | null; total: number; executed: number; months: MatrixCell[][];
    };
    const CRIT_ORDER = ['CRITICA', 'ALTA', 'MEDIA', 'BAJA'];
    const groupInfo = (a: Item) => {
      const p = a.program;
      if (p.targetType === 'GRUPO') return { key: `p:${p.id}`, name: p.group?.name ?? p.name, type: 'Grupo personalizado' };
      if (p.targetType === 'SUBCATEGORIA') return { key: `p:${p.id}`, name: p.subcategory?.name ?? p.name, type: 'Subcategoría' };
      if (p.targetType === 'CATEGORIA') return { key: `p:${p.id}`, name: p.category?.name ?? p.name, type: 'Categoría' };
      const snap = a.programSnapshot as Record<string, string | undefined>;
      const sub = a.asset.subcategory;
      return {
        key: `a:${sub ? `s${sub.id}` : `c${a.asset.category.id}`}|${p.kind}|${snap.frequencyLabel ?? p.frequencyType}`,
        name: sub?.name ?? a.asset.category.name,
        type: sub ? 'Subcategoría (equipos individuales)' : 'Categoría (equipos individuales)',
      };
    };

    const rows = new Map<string, MatrixRow & { assetIds: Set<string>; names: Set<string>; responsibles: Set<string>; areas: Set<string>; categories: Set<string>; raw: (MatrixActivity & { date: string; day: number; executed: boolean })[][] }>();
    for (const a of items) {
      if (Number(a.committedDate.slice(0, 4)) !== year) continue;
      const snap = a.programSnapshot as Record<string, string | undefined>;
      const g = groupInfo(a);
      const rowId = view === 'grupos' ? g.key : `${a.programId}|${a.asset.id}`;
      let r = rows.get(rowId);
      if (!r) {
        r = {
          rowId, programId: a.programId, programCode: a.program.code, programName: a.program.name, kind: a.program.kind,
          targetName: g.name, groupType: g.type, grouped: view === 'grupos',
          assetId: view === 'grupos' ? null : a.asset.id, assetCode: view === 'grupos' ? '' : a.asset.code, assetName: view === 'grupos' ? '' : a.asset.name,
          assetCount: 0, areaName: a.asset.area.name, categoryName: a.asset.category.name, criticality: a.asset.criticality,
          frequency: snap.frequencyLabel ?? '', responsible: null, total: 0, executed: 0, months: [],
          assetIds: new Set(), names: new Set(), responsibles: new Set(), areas: new Set(), categories: new Set(),
          raw: Array.from({ length: 12 }, () => []),
        };
        rows.set(rowId, r);
      }
      r.assetIds.add(a.asset.id);
      r.names.add(a.program.name);
      if (a.responsible?.fullName) r.responsibles.add(a.responsible.fullName);
      r.areas.add(a.asset.area.name);
      r.categories.add(a.asset.category.name);
      if (CRIT_ORDER.indexOf(a.asset.criticality) < CRIT_ORDER.indexOf(r.criticality)) r.criticality = a.asset.criticality;
      r.total++;
      if (a.status === 'EJECUTADO') r.executed++;
      r.raw[Number(a.committedDate.slice(5, 7)) - 1].push({
        id: a.id, assetId: a.asset.id, assetCode: a.asset.code, assetName: a.asset.name, status: a.displayStatus,
        rescheduled: a.rescheduled, originalDate: a.originalDate, date: a.committedDate, day: Number(a.committedDate.slice(8, 10)),
        executed: a.status === 'EJECUTADO',
      });
    }

    const kindLabel: Record<string, string> = { PREVENTIVO: 'preventivo', CORRECTIVO: 'correctivo', INSPECCION: 'de inspección', CALIBRACION: 'de calibración', VERIFICACION_METROLOGICA: 'de verificación técnica', LIMPIEZA: 'de limpieza', PRUEBA_FUNCIONAL: 'de prueba funcional', OTRO: '' };
    const result: MatrixRow[] = [...rows.values()].map(({ assetIds, names, responsibles, areas, categories, raw, ...r }) => {
      r.assetCount = assetIds.size;
      if (r.grouped && names.size > 1) r.programName = `Mantenimiento ${kindLabel[r.kind] ?? ''}`.trim();
      r.responsible = responsibles.size === 0 ? null : responsibles.size === 1 ? [...responsibles][0] : 'Varios responsables';
      if (areas.size > 1) r.areaName = 'Varias áreas';
      if (categories.size > 1) r.categoryName = 'Varias categorías';
      r.months = raw.map((month) => {
        const byDate = new Map<string, typeof month>();
        for (const x of month) byDate.set(x.date, [...(byDate.get(x.date) ?? []), x]);
        return [...byDate.values()]
          .sort((p, q) => p[0].date.localeCompare(q[0].date))
          .map((acts) => {
            const statuses = acts.map((x) => x.status);
            return {
              id: acts[0].id, day: acts[0].day, date: acts[0].date,
              status: summarizeStatus(statuses), mixed: new Set(statuses).size > 1,
              rescheduled: acts.some((x) => x.rescheduled), originalDate: acts[0].originalDate,
              count: acts.length, executed: acts.filter((x) => x.executed).length,
              activities: acts.map(({ id, assetId, assetCode, assetName, status, rescheduled, originalDate }) => ({ id, assetId, assetCode, assetName, status, rescheduled, originalDate })),
            };
          });
      });
      return r;
    });
    result.sort((p, q) => p.targetName.localeCompare(q.targetName, 'es') || p.programName.localeCompare(q.programName, 'es') || p.assetCode.localeCompare(q.assetCode));

    const monthTotals = Array.from({ length: 12 }, (_, i) => ({
      total: result.reduce((s, r) => s + r.months[i].reduce((c, x) => c + x.count, 0), 0),
      executed: result.reduce((s, r) => s + r.months[i].reduce((c, x) => c + x.executed, 0), 0),
    }));
    return {
      planId: plan.id, planStatus: plan.status, version: plan.version, year, today, view,
      scheduleType: f.scheduleType ?? null,
      assetCount: new Set(items.map((a) => a.asset.id)).size,
      total: result.reduce((s, r) => s + r.total, 0),
      executed: result.reduce((s, r) => s + r.executed, 0),
      monthTotals,
      rows: result,
    };
  }

  async summary(ctx: ReqCtx, year: number, f: ActivityFilters = {}) {
    const { plan, items } = await this.allActivities(ctx, year, f);
    const byCategory: Record<string, { total: number; executed: number; byStatus: Record<string, number> }> = {};
    const byMonth = Array.from({ length: 12 }, () => ({ total: 0, executed: 0 }));
    const byStatus: Record<string, number> = {};
    for (const a of items) {
      const cat = a.asset.category.name;
      byCategory[cat] ??= { total: 0, executed: 0, byStatus: {} };
      byCategory[cat].total++;
      byCategory[cat].byStatus[a.displayStatus] = (byCategory[cat].byStatus[a.displayStatus] ?? 0) + 1;
      if (a.status === 'EJECUTADO') byCategory[cat].executed++;
      const m = Number(a.committedDate.slice(5, 7)) - 1;
      byMonth[m].total++;
      if (a.status === 'EJECUTADO') byMonth[m].executed++;
      byStatus[a.displayStatus] = (byStatus[a.displayStatus] ?? 0) + 1;
    }
    return { year, planStatus: plan.status, version: plan.version, total: items.length, byCategory, byMonth, byStatus };
  }

  async history(year: number) {
    const plan = await this.requirePlan(year);
    const [events, versions, reschedules] = await Promise.all([
      this.prisma.annualPlanEvent.findMany({ where: { planId: plan.id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.annualPlanVersion.findMany({ where: { planId: plan.id }, select: { id: true, version: true, approvedAt: true, approvedById: true, activityCount: true, reason: true }, orderBy: { version: 'desc' } }),
      this.prisma.reschedule.findMany({
        where: { activity: { planId: plan.id } },
        include: { activity: { select: { id: true, programSnapshot: true, originalDate: true } } },
        orderBy: { requestedAt: 'desc' },
      }),
    ]);
    const ids = [...events.map((e) => e.userId), ...versions.map((v) => v.approvedById), ...reschedules.flatMap((r) => [r.requestedById, r.decidedById ?? ''])];
    const users = await this.userNames(ids);
    return {
      events: events.map((e) => ({ ...e, id: e.id.toString(), user: users.get(e.userId) ?? null })),
      versions: versions.map((v) => ({ ...v, approvedBy: users.get(v.approvedById) ?? null })),
      reschedules: reschedules.map((r) => ({
        ...r, fromDate: fmtYmd(r.fromDate), toDate: fmtYmd(r.toDate),
        activity: { ...r.activity, originalDate: fmtYmd(r.activity.originalDate) },
        requestedBy: users.get(r.requestedById) ?? null, decidedBy: r.decidedById ? users.get(r.decidedById) ?? null : null,
      })),
    };
  }

  // -------------------------------------------------------------- Reprogramación
  /**
   * Conserva: fecha originalmente aprobada (originalDate), fecha comprometida (committedDate) y fecha real (executedDate).
   * - Plan BORRADOR: el cambio se aplica de inmediato a ambas fechas (aún no hay línea base aprobada) y queda registrado.
   * - Plan APROBADO: queda PENDIENTE hasta su aprobación; si el solicitante tiene plans.approve puede aprobarse en el mismo acto.
   */
  async requestReschedule(ctx: ReqCtx, activityId: string, toDate: string, reason: string, autoApprove = false) {
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.scheduledActivity.findUnique({ where: { id: activityId }, include: { plan: true, asset: true } });
      if (!a) throw new NotFoundException('Actividad no encontrada');
      assertAreaAccess(ctx.user, a.asset.areaId);
      if (!['PROGRAMADO', 'REPROGRAMADO'].includes(a.status)) throw new ConflictException(`No se puede reprogramar una actividad en estado ${a.status}`);
      if (a.plan.status === 'CERRADO') throw new ConflictException('El plan está cerrado');
      if (a.plan.status === 'EN_REVISION') throw new ConflictException('El plan está en revisión; devuélvalo a borrador para modificarlo');
      if (fmtYmd(a.committedDate) === toDate) throw new BadRequestException('La nueva fecha es igual a la fecha comprometida actual');
      if (Number(toDate.slice(0, 4)) !== a.plan.year) throw new BadRequestException(`La nueva fecha debe pertenecer al año del plan (${a.plan.year})`);
      const pending = await tx.reschedule.findFirst({ where: { activityId, status: 'PENDIENTE' } });
      if (pending) throw new ConflictException('Ya existe una solicitud de reprogramación pendiente para esta actividad');

      if (a.plan.status === 'BORRADOR') {
        const r = await tx.reschedule.create({
          data: { activityId, fromDate: a.committedDate, toDate: parseYmd(toDate), reason, status: 'APROBADA', requestedById: ctx.user.id, decidedById: ctx.user.id, decidedAt: new Date(), decisionNote: 'Ajuste en borrador (sin línea base aprobada)' },
        });
        await tx.scheduledActivity.update({ where: { id: activityId }, data: { originalDate: parseYmd(toDate), committedDate: parseYmd(toDate) } });
        await tx.annualPlanEvent.create({ data: { planId: a.planId, action: 'AJUSTE_BORRADOR', version: a.plan.version, detail: { activityId, from: fmtYmd(a.committedDate), to: toDate }, reason, userId: ctx.user.id } });
        await this.audit.log(ctx, { action: 'REPROGRAMAR', module: 'cronograma', entity: 'ScheduledActivity', entityId: activityId, before: { committedDate: fmtYmd(a.committedDate) }, after: { committedDate: toDate }, reason }, tx);
        return { ...r, applied: true };
      }

      const r = await tx.reschedule.create({ data: { activityId, fromDate: a.committedDate, toDate: parseYmd(toDate), reason, requestedById: ctx.user.id } });
      await this.audit.log(ctx, { action: 'SOLICITAR_REPROGRAMACION', module: 'cronograma', entity: 'Reschedule', entityId: r.id, after: { activityId, from: fmtYmd(a.committedDate), to: toDate }, reason }, tx);
      if (autoApprove && can(ctx.user, 'plans.approve')) {
        return this.applyDecision(tx, ctx, r.id, true, 'Aprobada por el coordinador al solicitarla');
      }
      return { ...r, applied: false };
    });
  }

  async decideReschedule(ctx: ReqCtx, id: string, approve: boolean, note?: string | null) {
    return this.prisma.$transaction((tx) => this.applyDecision(tx, ctx, id, approve, note));
  }

  private async applyDecision(tx: Tx, ctx: ReqCtx, id: string, approve: boolean, note?: string | null) {
    const r = await tx.reschedule.findUnique({ where: { id }, include: { activity: { include: { plan: true } } } });
    if (!r) throw new NotFoundException('Solicitud no encontrada');
    if (r.status !== 'PENDIENTE') throw new ConflictException('La solicitud ya fue decidida');
    if (!approve && (!note || note.trim().length < 5)) throw new BadRequestException('Indique el motivo del rechazo');
    const a = r.activity;
    if (approve && !['PROGRAMADO', 'REPROGRAMADO'].includes(a.status)) throw new ConflictException('La actividad ya no admite reprogramación');
    const decided = await tx.reschedule.update({
      where: { id },
      data: { status: approve ? 'APROBADA' : 'RECHAZADA', decidedById: ctx.user.id, decidedAt: new Date(), decisionNote: note ?? null },
    });
    if (approve) {
      await tx.scheduledActivity.update({ where: { id: a.id }, data: { committedDate: r.toDate, status: 'REPROGRAMADO' } });
      await this.bumpVersionIfApproved(tx, a.planId, ctx.user.id, 'REPROGRAMACION', { activityId: a.id, originalDate: fmtYmd(a.originalDate), from: fmtYmd(r.fromDate), to: fmtYmd(r.toDate), rescheduleId: id }, r.reason);
    }
    await this.audit.log(ctx, {
      action: approve ? 'APROBAR_REPROGRAMACION' : 'RECHAZAR_REPROGRAMACION', module: 'cronograma', entity: 'Reschedule', entityId: id,
      before: { committedDate: fmtYmd(a.committedDate) }, after: approve ? { committedDate: fmtYmd(r.toDate), originalDate: fmtYmd(a.originalDate) } : { rechazada: true }, reason: note ?? r.reason,
    }, tx);
    return { ...decided, applied: approve };
  }

  async pendingReschedules(ctx: ReqCtx) {
    const rows = await this.prisma.reschedule.findMany({
      where: { status: 'PENDIENTE', activity: { asset: areaFilter(ctx.user) } },
      include: { activity: { include: { asset: { select: { code: true, name: true } }, plan: { select: { year: true } } } } },
      orderBy: { requestedAt: 'asc' },
    });
    const users = await this.userNames(rows.map((r) => r.requestedById));
    return rows.map((r) => ({
      ...r, fromDate: fmtYmd(r.fromDate), toDate: fmtYmd(r.toDate), requestedBy: users.get(r.requestedById) ?? null,
      activity: { ...r.activity, originalDate: fmtYmd(r.activity.originalDate), committedDate: fmtYmd(r.activity.committedDate) },
    }));
  }

  // -------------------------------------------------------------- Otras acciones sobre actividades
  async setActivityStatus(ctx: ReqCtx, activityId: string, status: 'CANCELADO' | 'NO_APLICA' | 'PROGRAMADO', reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.scheduledActivity.findUnique({ where: { id: activityId }, include: { plan: true, asset: true, workOrder: true } });
      if (!a) throw new NotFoundException('Actividad no encontrada');
      assertAreaAccess(ctx.user, a.asset.areaId);
      if (a.plan.status === 'EN_REVISION') throw new ConflictException('El plan está en revisión');
      if (a.status === 'EJECUTADO' || a.status === 'EN_EJECUCION') throw new ConflictException('No se puede cambiar el estado de una actividad ejecutada o en ejecución');
      if (status === 'PROGRAMADO' && !['CANCELADO', 'NO_APLICA'].includes(a.status)) throw new ConflictException('Solo se pueden restituir actividades canceladas o no aplicables');
      if (a.workOrder && !['CANCELADA'].includes(a.workOrder.status)) throw new ConflictException('La actividad tiene una orden de trabajo activa; cancele primero la orden');
      if (a.plan.status === 'APROBADO' && !can(ctx.user, 'plans.approve')) throw new ForbiddenException('Modificar un plan aprobado requiere el permiso plans.approve');
      const restored: ActivityStatus = status === 'PROGRAMADO' ? (fmtYmd(a.originalDate) !== fmtYmd(a.committedDate) ? 'REPROGRAMADO' : 'PROGRAMADO') : status;
      const updated = await tx.scheduledActivity.update({ where: { id: activityId }, data: { status: restored, statusReason: reason } });
      await this.bumpVersionIfApproved(tx, a.planId, ctx.user.id, `ACTIVIDAD_${status}`, { activityId, from: a.status, to: restored }, reason);
      await this.audit.log(ctx, { action: `ACTIVIDAD_${status}`, module: 'cronograma', entity: 'ScheduledActivity', entityId: activityId, before: { status: a.status }, after: { status: restored }, reason }, tx);
      return updated;
    });
  }

  async assignResponsible(ctx: ReqCtx, activityId: string, userId: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.scheduledActivity.findUniqueOrThrow({ where: { id: activityId }, include: { asset: true } });
      assertAreaAccess(ctx.user, a.asset.areaId);
      if (userId) await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const r = await tx.scheduledActivity.update({ where: { id: activityId }, data: { responsibleId: userId } });
      await this.audit.log(ctx, { action: 'ASIGNAR_RESPONSABLE', module: 'cronograma', entity: 'ScheduledActivity', entityId: activityId, before: { responsibleId: a.responsibleId }, after: { responsibleId: userId } }, tx);
      return r;
    });
  }

  async getActivity(ctx: ReqCtx, id: string) {
    const a = await this.prisma.scheduledActivity.findUnique({
      where: { id },
      include: {
        asset: { include: { area: true, category: true } },
        program: true,
        plan: { select: { id: true, year: true, status: true, version: true } },
        responsible: { select: { id: true, fullName: true } },
        workOrder: { select: { id: true, code: true, status: true } },
        reschedules: { orderBy: { requestedAt: 'desc' } },
      },
    });
    if (!a) throw new NotFoundException('Actividad no encontrada');
    assertAreaAccess(ctx.user, a.asset.areaId);
    const upcoming = await this.settings.get<number>('schedule.upcomingDays');
    return { ...this.presentActivity(a, todayBogota(), upcoming), reschedules: a.reschedules.map((r) => ({ ...r, fromDate: fmtYmd(r.fromDate), toDate: fmtYmd(r.toDate) })) };
  }

  async userNames(ids: (string | null | undefined)[]) {
    const clean = [...new Set(ids.filter((x): x is string => !!x))];
    const users = clean.length ? await this.prisma.user.findMany({ where: { id: { in: clean } }, select: { id: true, fullName: true } }) : [];
    return new Map(users.map((u) => [u.id, u.fullName]));
  }

  private validateYear(year: number) {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BadRequestException('Año inválido');
  }
}
