import { BadRequestException, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService, diff } from '../../common/audit.service';
import type { ReqCtx } from '../../common/auth.types';
import { CountersService } from '../../common/counters.service';
import { currentYearBogota, fmtYmd, parseYmd } from '../../common/dates';
import { Ctx, Perms } from '../../common/decorators';
import { PrismaService, Tx } from '../../common/prisma.service';
import { areaFilter, assertAreaAccess } from '../../common/scope';
import { ApiZBody, ApiZQuery, zBoolQ, zOptText, zOptUuid, zOptYmd, zPage, zText, zYmd, ZBody, ZQuery } from '../../common/zod';
import type { Prisma } from '../../generated/prisma/client';
import { INACTIVE_STATUSES } from '../assets/assets.service';
import { describeRule, occurrencesInYear, validateRule } from '../plans/recurrence';

const FREQ = z.enum(['SEMANAL', 'QUINCENAL', 'MENSUAL', 'BIMESTRAL', 'TRIMESTRAL', 'CUATRIMESTRAL', 'SEMESTRAL', 'ANUAL', 'PERSONALIZADO', 'FECHAS_ESPECIFICAS', 'SEMANA_DEL_MES']);
const KIND = z.enum(['PREVENTIVO', 'CORRECTIVO', 'INSPECCION', 'CALIBRACION', 'VERIFICACION_METROLOGICA', 'LIMPIEZA', 'PRUEBA_FUNCIONAL', 'OTRO']);
const TARGET = z.enum(['ACTIVO', 'CATEGORIA', 'SUBCATEGORIA', 'GRUPO']);
const DISPLAY = z.enum(['POR_ACTIVO', 'AGRUPADO']);
const ChecklistItem = z.object({ id: z.string().min(1).max(40), text: z.string().trim().min(2).max(300), required: z.boolean().default(true) });

const ProgramShape = z.object({
  targetType: TARGET.default('ACTIVO'),
  displayMode: DISPLAY.default('POR_ACTIVO'),
  assetId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  subcategoryId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  kind: KIND.default('PREVENTIVO'),
  name: zText(3, 200),
  description: zOptText(2000),
  procedure: zOptText(10000),
  checklist: z.array(ChecklistItem).max(100).default([]),
  frequencyType: FREQ,
  intervalValue: z.coerce.number().int().min(1).max(3650).optional().nullable(),
  intervalUnit: z.enum(['DIAS', 'SEMANAS', 'MESES']).optional().nullable(),
  specificDates: z.array(z.string().regex(/^\d{2}-\d{2}$/, 'Use MM-DD')).max(366).default([]),
  monthsOfYear: z.array(z.coerce.number().int().min(1).max(12)).max(12).default([]),
  weekOfMonth: z.coerce.number().int().refine((value) => value === -1 || (value >= 1 && value <= 4)).optional().nullable(),
  dayOfWeek: z.coerce.number().int().min(1).max(7).optional().nullable(),
  startDate: zYmd,
  baseDate: zYmd,
  endDate: zOptYmd,
  lastPerformedDate: zOptYmd,
  estimatedDurationMin: z.coerce.number().int().min(1).max(100000).optional().nullable(),
  responsibleId: zOptUuid,
  supplierId: zOptUuid,
  technicalRequirements: zOptText(4000),
  references: zOptText(4000),
  frequencyJustification: z.string().trim().min(10, 'Documente el sustento técnico de la periodicidad (fabricante, norma, historial, evaluación técnica)').max(2000),
  notes: zOptText(4000),
});
const ProgramBase = ProgramShape.superRefine((b, ctx) => {
  const targetId = b.targetType === 'ACTIVO' ? b.assetId
    : b.targetType === 'CATEGORIA' ? b.categoryId
      : b.targetType === 'SUBCATEGORIA' ? b.subcategoryId : b.groupId;
  if (!targetId) ctx.addIssue({ code: 'custom', message: 'Seleccione el activo o agrupación que recibirá este programa' });
  if (b.targetType === 'SUBCATEGORIA' && !b.categoryId) ctx.addIssue({ code: 'custom', message: 'Seleccione la categoría de la subcategoría' });
  if (b.targetType === 'ACTIVO' && b.displayMode === 'AGRUPADO') ctx.addIssue({ code: 'custom', message: 'La vista agrupada requiere una categoría o agrupación' });
});
const ProgramUpdate = ProgramShape.partial().extend({
  targetType: TARGET.optional(),
  displayMode: DISPLAY.optional(),
  kind: KIND.optional(),
  checklist: z.array(ChecklistItem).max(100).optional(),
  specificDates: z.array(z.string().regex(/^\d{2}-\d{2}$/, 'Use MM-DD')).max(366).optional(),
  monthsOfYear: z.array(z.coerce.number().int().min(1).max(12)).max(12).optional(),
  isActive: z.boolean().optional(),
  changeReason: zOptText(1000),
});
const ProgramQuery = z.object({
  ...zPage,
  assetId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  subcategoryId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  targetType: TARGET.optional(),
  areaId: z.string().uuid().optional(),
  frequencyType: FREQ.optional(),
  kind: KIND.optional(),
  /** Cronograma al que pertenece: PREVENTIVO (todo menos correctivo) o CORRECTIVO */
  scheduleType: z.enum(['PREVENTIVO', 'CORRECTIVO']).optional(),
  active: zBoolQ,
});

const RULE_FIELDS = ['frequencyType', 'intervalValue', 'intervalUnit', 'specificDates', 'monthsOfYear', 'weekOfMonth', 'dayOfWeek', 'startDate', 'baseDate', 'endDate'] as const;
type ProgramTarget = { assetId?: string | null; categoryId?: string | null; subcategoryId?: string | null; groupId?: string | null };

@ApiTags('Plan maestro de mantenimiento')
@Controller('programs')
export class ProgramsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CountersService,
  ) {}

  @Get()
  @Perms('programs.read')
  @ApiZQuery(ProgramQuery)
  async list(@Ctx() ctx: ReqCtx, @ZQuery(ProgramQuery) q: z.infer<typeof ProgramQuery>) {
    const assetScope = { ...areaFilter(ctx.user), ...(q.areaId ? { areaId: q.areaId } : {}) };
    const where: Prisma.MaintenanceProgramWhereInput = {
      AND: [
        {
          OR: [
            { targetType: 'ACTIVO', asset: { is: assetScope } },
            { targetType: 'CATEGORIA', category: { is: { assets: { some: assetScope } } } },
            { targetType: 'SUBCATEGORIA', subcategory: { is: { assets: { some: assetScope } } } },
            { targetType: 'GRUPO', group: { is: { assets: { some: { asset: assetScope } } } } },
          ],
        },
        ...(q.assetId ? [{
          OR: [
            { targetType: 'ACTIVO' as const, assetId: q.assetId },
            { targetType: 'CATEGORIA' as const, category: { is: { assets: { some: { id: q.assetId } } } } },
            { targetType: 'SUBCATEGORIA' as const, subcategory: { is: { assets: { some: { id: q.assetId } } } } },
            { targetType: 'GRUPO' as const, group: { is: { assets: { some: { assetId: q.assetId } } } } },
          ],
        }] : []),
        ...(q.categoryId ? [{
          OR: [
            { asset: { is: { categoryId: q.categoryId } } },
            { categoryId: q.categoryId },
            { subcategory: { is: { categoryId: q.categoryId } } },
            { group: { is: { assets: { some: { asset: { categoryId: q.categoryId } } } } } },
          ],
        }] : []),
        ...(q.subcategoryId ? [{ subcategoryId: q.subcategoryId }] : []),
        ...(q.groupId ? [{ groupId: q.groupId }] : []),
        ...(q.targetType ? [{ targetType: q.targetType }] : []),
        ...(q.frequencyType ? [{ frequencyType: q.frequencyType }] : []),
        ...(q.kind ? [{ kind: q.kind }] : []),
        ...(q.scheduleType === 'CORRECTIVO' ? [{ kind: 'CORRECTIVO' as const }] : q.scheduleType === 'PREVENTIVO' ? [{ kind: { not: 'CORRECTIVO' as const } }] : []),
        ...(q.active !== undefined ? [{ isActive: q.active }] : []),
        ...(q.q ? [{
          OR: [
            { code: { contains: q.q, mode: 'insensitive' as const } },
            { name: { contains: q.q, mode: 'insensitive' as const } },
            { asset: { is: { name: { contains: q.q, mode: 'insensitive' as const } } } },
            { asset: { is: { code: { contains: q.q, mode: 'insensitive' as const } } } },
            { category: { is: { name: { contains: q.q, mode: 'insensitive' as const } } } },
            { subcategory: { is: { name: { contains: q.q, mode: 'insensitive' as const } } } },
            { group: { is: { name: { contains: q.q, mode: 'insensitive' as const } } } },
          ],
        }] : []),
      ],
    };
    const [items, total] = await Promise.all([
      this.prisma.maintenanceProgram.findMany({
        where,
        include: {
          asset: { select: { id: true, code: true, name: true, status: true, criticality: true, area: { select: { id: true, name: true } } } },
          category: { select: { id: true, name: true, _count: { select: { assets: { where: { status: { notIn: INACTIVE_STATUSES } } } } } } },
          subcategory: { select: { id: true, name: true, _count: { select: { assets: { where: { status: { notIn: INACTIVE_STATUSES } } } } } } },
          group: { select: { id: true, name: true, assets: { where: { asset: { status: { notIn: INACTIVE_STATUSES } } }, select: { assetId: true } } } },
          responsible: { select: { id: true, fullName: true } },
          supplier: { select: { id: true, name: true } },
        },
        orderBy: { code: 'asc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.maintenanceProgram.count({ where }),
    ]);
    return { items: items.map((p) => this.present(p)), total };
  }

  @Get(':id')
  @Perms('programs.read')
  async get(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    const p = await this.prisma.maintenanceProgram.findUnique({
      where: { id },
      include: {
        asset: { select: { id: true, code: true, name: true, areaId: true, status: true, criticality: true, subcategoryId: true } },
        category: { select: { id: true, name: true, _count: { select: { assets: { where: { status: { notIn: INACTIVE_STATUSES } } } } } } },
        subcategory: { select: { id: true, name: true, _count: { select: { assets: { where: { status: { notIn: INACTIVE_STATUSES } } } } } } },
        group: { select: { id: true, name: true, assets: { where: { asset: { status: { notIn: INACTIVE_STATUSES } } }, select: { assetId: true } } } },
        responsible: { select: { id: true, fullName: true } }, supplier: { select: { id: true, name: true } },
      },
    });
    if (!p) throw new NotFoundException('Programa no encontrado');
    await this.assertTargetAccess(ctx, p);
    return this.present(p);
  }

  /** Vista previa de fechas que el programa genera para un año (no guarda nada) */
  @Get(':id/preview/:year')
  @Perms('programs.read')
  async preview(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Param('year') yearS: string) {
    const year = Number(yearS);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BadRequestException('Año inválido');
    const p = await this.prisma.maintenanceProgram.findUniqueOrThrow({ where: { id } });
    await this.assertTargetAccess(ctx, p);
    return { year, dates: occurrencesInYear(this.rule(p), year) };
  }

  @Post()
  @Perms('programs.write')
  @ApiZBody(ProgramBase)
  async create(@Ctx() ctx: ReqCtx, @ZBody(ProgramBase) b: z.infer<typeof ProgramBase>) {
    const errs = validateRule(b);
    if (errs.length) throw new BadRequestException(errs.join('; '));
    return this.prisma.$transaction(async (tx) => {
      const target = await this.resolveTarget(ctx, b.targetType, b, tx);
      const n = await this.counters.next(tx, 'PROGRAM', 0);
      const p = await tx.maintenanceProgram.create({
        data: {
          targetType: b.targetType,
          displayMode: b.targetType === 'ACTIVO' ? 'POR_ACTIVO' : b.displayMode,
          ...target,
          kind: b.kind,
          name: b.name,
          description: b.description,
          procedure: b.procedure,
          checklist: b.checklist,
          frequencyType: b.frequencyType,
          intervalValue: b.frequencyType === 'PERSONALIZADO' ? b.intervalValue : null,
          intervalUnit: b.frequencyType === 'PERSONALIZADO' ? b.intervalUnit : null,
          specificDates: b.frequencyType === 'FECHAS_ESPECIFICAS' ? b.specificDates : [],
          monthsOfYear: b.frequencyType === 'SEMANA_DEL_MES' ? b.monthsOfYear : [],
          weekOfMonth: b.frequencyType === 'SEMANA_DEL_MES' ? b.weekOfMonth : null,
          dayOfWeek: b.frequencyType === 'SEMANA_DEL_MES' ? b.dayOfWeek : null,
          startDate: parseYmd(b.startDate),
          baseDate: parseYmd(b.baseDate),
          endDate: b.endDate ? parseYmd(b.endDate) : null,
          lastPerformedDate: b.lastPerformedDate ? parseYmd(b.lastPerformedDate) : null,
          estimatedDurationMin: b.estimatedDurationMin,
          responsibleId: b.responsibleId,
          supplierId: b.supplierId,
          technicalRequirements: b.technicalRequirements,
          references: b.references,
          frequencyJustification: b.frequencyJustification,
          notes: b.notes,
          code: `PM-${String(n).padStart(5, '0')}`,
          createdById: ctx.user.id,
        },
      });
      await this.audit.log(ctx, { action: 'CREAR', module: 'programas', entity: 'MaintenanceProgram', entityId: p.id, after: p }, tx);
      return p;
    });
  }

  /**
   * Edición de programas. Los cambios NO alteran automáticamente actividades ya generadas en planes
   * aprobados (cada actividad conserva una instantánea del programa). En planes en borrador,
   * el ajuste se aplica al volver a ejecutar la generación.
   */
  @Patch(':id')
  @Perms('programs.write')
  @ApiZBody(ProgramUpdate)
  async update(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(ProgramUpdate) b: z.infer<typeof ProgramUpdate>) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.maintenanceProgram.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Programa no encontrado');
      await this.assertTargetAccess(ctx, before);
      const merged = {
        frequencyType: b.frequencyType ?? before.frequencyType,
        intervalValue: b.intervalValue !== undefined ? b.intervalValue : before.intervalValue,
        intervalUnit: b.intervalUnit !== undefined ? b.intervalUnit : before.intervalUnit,
        specificDates: b.specificDates ?? before.specificDates,
        monthsOfYear: b.monthsOfYear ?? before.monthsOfYear,
        weekOfMonth: b.weekOfMonth !== undefined ? b.weekOfMonth : before.weekOfMonth,
        dayOfWeek: b.dayOfWeek !== undefined ? b.dayOfWeek : before.dayOfWeek,
        startDate: b.startDate ?? fmtYmd(before.startDate),
        baseDate: b.baseDate ?? fmtYmd(before.baseDate),
        endDate: b.endDate !== undefined ? b.endDate : before.endDate ? fmtYmd(before.endDate) : null,
      };
      const errs = validateRule(merged);
      if (errs.length) throw new BadRequestException(errs.join('; '));
      const ruleChanged = RULE_FIELDS.some((k) => {
        if (b[k] === undefined) return false;
        const old = k.endsWith('Date') ? (before[k] ? fmtYmd(before[k] as Date) : null) : before[k];
        return JSON.stringify(b[k]) !== JSON.stringify(old);
      });
      if (ruleChanged && !b.changeReason) throw new BadRequestException('Indique el motivo del cambio de periodicidad (changeReason)');
      const targetChanged = b.targetType !== undefined || b.assetId !== undefined || b.categoryId !== undefined || b.subcategoryId !== undefined || b.groupId !== undefined;
      const targetType = b.targetType ?? before.targetType;
      if (targetType === 'ACTIVO' && b.displayMode === 'AGRUPADO') {
        throw new BadRequestException('La vista agrupada requiere una categoría o agrupación');
      }
      let targetData: Awaited<ReturnType<ProgramsController['resolveTarget']>> | null = null;
      if (targetChanged) {
        targetData = await this.resolveTarget(ctx, targetType, {
          assetId: b.assetId,
          categoryId: b.categoryId,
          subcategoryId: b.subcategoryId,
          groupId: b.groupId,
        }, tx);
        const sameTarget = targetType === before.targetType &&
          targetData.assetId === before.assetId && targetData.categoryId === before.categoryId &&
          targetData.subcategoryId === before.subcategoryId && targetData.groupId === before.groupId;
        if (!sameTarget && await tx.scheduledActivity.count({ where: { programId: id } })) {
          throw new ConflictException('No se puede cambiar el alcance de un programa que ya tiene actividades; cree uno nuevo.');
        }
      }
      const { changeReason: _changeReason, assetId: _assetId, categoryId: _categoryId, subcategoryId: _subcategoryId, groupId: _groupId, targetType: _targetType, ...fields } = b;
      const data: Prisma.MaintenanceProgramUncheckedUpdateInput = {
        ...fields,
        ...(targetData ? { targetType, ...targetData } : {}),
        displayMode: b.displayMode ?? (targetType === 'ACTIVO' ? 'POR_ACTIVO' : undefined),
        startDate: b.startDate ? parseYmd(b.startDate) : undefined,
        baseDate: b.baseDate ? parseYmd(b.baseDate) : undefined,
        endDate: b.endDate !== undefined ? (b.endDate ? parseYmd(b.endDate) : null) : undefined,
        lastPerformedDate: b.lastPerformedDate !== undefined ? (b.lastPerformedDate ? parseYmd(b.lastPerformedDate) : null) : undefined,
        intervalValue: b.frequencyType ? (b.frequencyType === 'PERSONALIZADO' ? b.intervalValue ?? null : null) : undefined,
        intervalUnit: b.frequencyType ? (b.frequencyType === 'PERSONALIZADO' ? b.intervalUnit ?? null : null) : undefined,
        specificDates: b.frequencyType ? (b.frequencyType === 'FECHAS_ESPECIFICAS' ? b.specificDates ?? [] : []) : undefined,
        monthsOfYear: b.frequencyType ? (b.frequencyType === 'SEMANA_DEL_MES' ? b.monthsOfYear ?? [] : []) : undefined,
        weekOfMonth: b.frequencyType ? (b.frequencyType === 'SEMANA_DEL_MES' ? b.weekOfMonth ?? null : null) : undefined,
        dayOfWeek: b.frequencyType ? (b.frequencyType === 'SEMANA_DEL_MES' ? b.dayOfWeek ?? null : null) : undefined,
        version: ruleChanged ? before.version + 1 : undefined,
      };
      const after = await tx.maintenanceProgram.update({ where: { id }, data });
      await this.audit.log(ctx, { action: ruleChanged ? 'CAMBIO_PERIODICIDAD' : 'EDITAR', module: 'programas', entity: 'MaintenanceProgram', entityId: id, ...diff(before, after), reason: b.changeReason ?? null }, tx);
      return after;
    });
  }

  private rule(p: { frequencyType: string; intervalValue: number | null; intervalUnit: string | null; specificDates: string[]; monthsOfYear: number[]; weekOfMonth: number | null; dayOfWeek: number | null; startDate: Date; baseDate: Date; endDate: Date | null }) {
    return {
      frequencyType: p.frequencyType as never,
      intervalValue: p.intervalValue,
      intervalUnit: p.intervalUnit as never,
      specificDates: p.specificDates,
      monthsOfYear: p.monthsOfYear,
      weekOfMonth: p.weekOfMonth,
      dayOfWeek: p.dayOfWeek,
      startDate: fmtYmd(p.startDate),
      baseDate: fmtYmd(p.baseDate),
      endDate: p.endDate ? fmtYmd(p.endDate) : null,
    };
  }

  private present<T extends Parameters<ProgramsController['rule']>[0] & {
    targetType: string;
    asset?: { name: string } | null;
    category?: { name: string; _count?: { assets: number } } | null;
    subcategory?: { name: string; _count?: { assets: number } } | null;
    group?: { name: string; assets?: { assetId: string }[] } | null;
  }>(p: T) {
    let nextDates: string[] = [];
    try {
      nextDates = occurrencesInYear(this.rule(p), currentYearBogota()).slice(0, 24);
    } catch {
      nextDates = [];
    }
    const targetName = p.targetType === 'ACTIVO' ? p.asset?.name
      : p.targetType === 'CATEGORIA' ? p.category?.name
        : p.targetType === 'SUBCATEGORIA' ? p.subcategory?.name : p.group?.name;
    const assetCount = p.targetType === 'GRUPO' ? p.group?.assets?.length ?? 0
      : p.targetType === 'CATEGORIA' ? p.category?._count?.assets
        : p.targetType === 'SUBCATEGORIA' ? p.subcategory?._count?.assets : undefined;
    return { ...p, targetName: targetName ?? null, assetCount, frequencyLabel: describeRule(this.rule(p)), occurrencesThisYear: nextDates.length };
  }

  private async resolveTarget(ctx: ReqCtx, targetType: z.infer<typeof TARGET>, target: ProgramTarget, tx: Tx) {
    if (targetType === 'ACTIVO') {
      const asset = target.assetId ? await tx.asset.findUnique({ where: { id: target.assetId } }) : null;
      if (!asset) throw new BadRequestException('Seleccione un activo existente');
      assertAreaAccess(ctx.user, asset.areaId);
      if (INACTIVE_STATUSES.includes(asset.status)) throw new ConflictException('No se pueden crear programas para activos retirados o dados de baja');
      return { assetId: asset.id, categoryId: asset.categoryId, subcategoryId: asset.subcategoryId, groupId: null };
    }
    if (targetType === 'CATEGORIA') {
      const category = target.categoryId ? await tx.assetCategory.findUnique({ where: { id: target.categoryId } }) : null;
      if (!category?.isActive) throw new BadRequestException('Seleccione una categoría activa');
      await this.assertSelectorAccess(ctx, { categoryId: category.id }, tx);
      return { assetId: null, categoryId: category.id, subcategoryId: null, groupId: null };
    }
    if (targetType === 'SUBCATEGORIA') {
      const subcategory = target.subcategoryId ? await tx.assetSubcategory.findUnique({ where: { id: target.subcategoryId } }) : null;
      if (!subcategory?.isActive || subcategory.categoryId !== target.categoryId) {
        throw new BadRequestException('Seleccione una subcategoría activa de la categoría indicada');
      }
      await this.assertSelectorAccess(ctx, { subcategoryId: subcategory.id }, tx);
      return { assetId: null, categoryId: subcategory.categoryId, subcategoryId: subcategory.id, groupId: null };
    }
    const group = target.groupId
      ? await tx.maintenanceGroup.findUnique({ where: { id: target.groupId }, include: { assets: { include: { asset: true } } } })
      : null;
    if (!group?.isActive || !group.assets.length) throw new BadRequestException('Seleccione una agrupación activa con activos');
    for (const member of group.assets) assertAreaAccess(ctx.user, member.asset.areaId);
    return { assetId: null, categoryId: null, subcategoryId: null, groupId: group.id };
  }

  private async assertSelectorAccess(ctx: ReqCtx, selector: { categoryId?: string; subcategoryId?: string }, tx: Tx) {
    const asset = await tx.asset.findFirst({
      where: { ...areaFilter(ctx.user), ...selector, status: { notIn: INACTIVE_STATUSES } },
      select: { id: true },
    });
    if (!asset) throw new ForbiddenException('No tiene acceso a activos de esta categoría o subcategoría');
  }

  private async assertTargetAccess(ctx: ReqCtx, target: ProgramTarget & { targetType: string }) {
    if (ctx.user.scope !== 'AREA') return;
    if (target.targetType === 'ACTIVO' && target.assetId) {
      const asset = await this.prisma.asset.findUnique({ where: { id: target.assetId }, select: { areaId: true } });
      if (!asset) throw new NotFoundException('Activo del programa no encontrado');
      assertAreaAccess(ctx.user, asset.areaId);
      return;
    }
    const selector = target.targetType === 'CATEGORIA' ? { categoryId: target.categoryId ?? undefined }
      : target.targetType === 'SUBCATEGORIA' ? { subcategoryId: target.subcategoryId ?? undefined }
        : { maintenanceGroupMembers: { some: { groupId: target.groupId ?? '' } } };
    const asset = await this.prisma.asset.findFirst({ where: { ...areaFilter(ctx.user), ...selector }, select: { id: true } });
    if (!asset) throw new ForbiddenException('No tiene acceso a activos de esta agrupación');
  }
}
