import { BadRequestException, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService, diff } from '../../common/audit.service';
import type { ReqCtx } from '../../common/auth.types';
import { CountersService } from '../../common/counters.service';
import { currentYearBogota, fmtYmd, parseYmd } from '../../common/dates';
import { Ctx, Perms } from '../../common/decorators';
import { PrismaService } from '../../common/prisma.service';
import { areaFilter, assertAreaAccess } from '../../common/scope';
import { ApiZBody, ApiZQuery, zBoolQ, zOptText, zOptUuid, zOptYmd, zPage, zText, zYmd, ZBody, ZQuery } from '../../common/zod';
import type { Prisma } from '../../generated/prisma/client';
import { INACTIVE_STATUSES } from '../assets/assets.service';
import { describeRule, occurrencesInYear, validateRule } from '../plans/recurrence';

const FREQ = z.enum(['SEMANAL', 'QUINCENAL', 'MENSUAL', 'BIMESTRAL', 'TRIMESTRAL', 'CUATRIMESTRAL', 'SEMESTRAL', 'ANUAL', 'PERSONALIZADO', 'FECHAS_ESPECIFICAS']);
const KIND = z.enum(['PREVENTIVO', 'INSPECCION', 'CALIBRACION', 'VERIFICACION_METROLOGICA', 'LIMPIEZA', 'PRUEBA_FUNCIONAL', 'OTRO']);
const ChecklistItem = z.object({ id: z.string().min(1).max(40), text: z.string().trim().min(2).max(300), required: z.boolean().default(true) });

const ProgramBase = z.object({
  assetId: z.string().uuid('Seleccione el activo'),
  kind: KIND.default('PREVENTIVO'),
  name: zText(3, 200),
  description: zOptText(2000),
  procedure: zOptText(10000),
  checklist: z.array(ChecklistItem).max(100).default([]),
  frequencyType: FREQ,
  intervalValue: z.coerce.number().int().min(1).max(3650).optional().nullable(),
  intervalUnit: z.enum(['DIAS', 'SEMANAS', 'MESES']).optional().nullable(),
  specificDates: z.array(z.string().regex(/^\d{2}-\d{2}$/, 'Use MM-DD')).max(366).default([]),
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
const ProgramUpdate = ProgramBase.partial().extend({ isActive: z.boolean().optional(), changeReason: zOptText(1000) });
const ProgramQuery = z.object({
  ...zPage,
  assetId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  areaId: z.string().uuid().optional(),
  frequencyType: FREQ.optional(),
  active: zBoolQ,
});

const RULE_FIELDS = ['frequencyType', 'intervalValue', 'intervalUnit', 'specificDates', 'startDate', 'baseDate', 'endDate'] as const;

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
    const where: Prisma.MaintenanceProgramWhereInput = {
      asset: { ...areaFilter(ctx.user), ...(q.areaId ? { areaId: q.areaId } : {}) },
      ...(q.assetId ? { assetId: q.assetId } : {}),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.frequencyType ? { frequencyType: q.frequencyType } : {}),
      ...(q.active !== undefined ? { isActive: q.active } : {}),
      ...(q.q ? { OR: [{ code: { contains: q.q, mode: 'insensitive' } }, { name: { contains: q.q, mode: 'insensitive' } }, { asset: { name: { contains: q.q, mode: 'insensitive' } } }, { asset: { code: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.maintenanceProgram.findMany({
        where,
        include: {
          asset: { select: { id: true, code: true, name: true, status: true, criticality: true, area: { select: { id: true, name: true } } } },
          category: { select: { id: true, name: true } },
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
        asset: { select: { id: true, code: true, name: true, areaId: true, status: true, criticality: true } },
        category: true, responsible: { select: { id: true, fullName: true } }, supplier: { select: { id: true, name: true } },
      },
    });
    if (!p) throw new NotFoundException('Programa no encontrado');
    assertAreaAccess(ctx.user, p.asset.areaId);
    return this.present(p);
  }

  /** Vista previa de fechas que el programa genera para un año (no guarda nada) */
  @Get(':id/preview/:year')
  @Perms('programs.read')
  async preview(@Param('id', ParseUUIDPipe) id: string, @Param('year') yearS: string) {
    const year = Number(yearS);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BadRequestException('Año inválido');
    const p = await this.prisma.maintenanceProgram.findUniqueOrThrow({ where: { id } });
    return { year, dates: occurrencesInYear(this.rule(p), year) };
  }

  @Post()
  @Perms('programs.write')
  @ApiZBody(ProgramBase)
  async create(@Ctx() ctx: ReqCtx, @ZBody(ProgramBase) b: z.infer<typeof ProgramBase>) {
    const errs = validateRule(b);
    if (errs.length) throw new BadRequestException(errs.join('; '));
    return this.prisma.$transaction(async (tx) => {
      const asset = await tx.asset.findUnique({ where: { id: b.assetId } });
      if (!asset) throw new BadRequestException('Activo inexistente');
      assertAreaAccess(ctx.user, asset.areaId);
      if (INACTIVE_STATUSES.includes(asset.status)) throw new ConflictException('No se pueden crear programas para activos retirados o dados de baja');
      const n = await this.counters.next(tx, 'PROGRAM', 0);
      const p = await tx.maintenanceProgram.create({
        data: {
          ...b,
          code: `PM-${String(n).padStart(5, '0')}`,
          categoryId: asset.categoryId,
          checklist: b.checklist,
          startDate: parseYmd(b.startDate),
          baseDate: parseYmd(b.baseDate),
          endDate: b.endDate ? parseYmd(b.endDate) : null,
          lastPerformedDate: b.lastPerformedDate ? parseYmd(b.lastPerformedDate) : null,
          intervalValue: b.frequencyType === 'PERSONALIZADO' ? b.intervalValue : null,
          intervalUnit: b.frequencyType === 'PERSONALIZADO' ? b.intervalUnit : null,
          specificDates: b.frequencyType === 'FECHAS_ESPECIFICAS' ? b.specificDates : [],
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
      const before = await tx.maintenanceProgram.findUnique({ where: { id }, include: { asset: true } });
      if (!before) throw new NotFoundException('Programa no encontrado');
      assertAreaAccess(ctx.user, before.asset.areaId);
      if (b.assetId && b.assetId !== before.assetId) {
        const hasActs = await tx.scheduledActivity.count({ where: { programId: id } });
        if (hasActs) throw new ConflictException('No se puede cambiar el activo de un programa con actividades generadas. Cree un programa nuevo.');
      }
      const merged = {
        frequencyType: b.frequencyType ?? before.frequencyType,
        intervalValue: b.intervalValue !== undefined ? b.intervalValue : before.intervalValue,
        intervalUnit: b.intervalUnit !== undefined ? b.intervalUnit : before.intervalUnit,
        specificDates: b.specificDates ?? before.specificDates,
        startDate: b.startDate ?? fmtYmd(before.startDate),
        baseDate: b.baseDate ?? fmtYmd(before.baseDate),
        endDate: b.endDate !== undefined ? b.endDate : before.endDate ? fmtYmd(before.endDate) : null,
      };
      const errs = validateRule(merged);
      if (errs.length) throw new BadRequestException(errs.join('; '));
      const ruleChanged = RULE_FIELDS.some((k) => b[k] !== undefined && JSON.stringify(b[k]) !== JSON.stringify(k.endsWith('Date') ? (before[k] ? fmtYmd(before[k] as Date) : null) : before[k]));
      if (ruleChanged && !b.changeReason) throw new BadRequestException('Indique el motivo del cambio de periodicidad (changeReason)');
      const { changeReason, ...rest } = b;
      const data: Prisma.MaintenanceProgramUncheckedUpdateInput = {
        ...rest,
        startDate: b.startDate ? parseYmd(b.startDate) : undefined,
        baseDate: b.baseDate ? parseYmd(b.baseDate) : undefined,
        endDate: b.endDate !== undefined ? (b.endDate ? parseYmd(b.endDate) : null) : undefined,
        lastPerformedDate: b.lastPerformedDate !== undefined ? (b.lastPerformedDate ? parseYmd(b.lastPerformedDate) : null) : undefined,
        version: ruleChanged ? before.version + 1 : undefined,
      };
      if (b.assetId) {
        const a = await tx.asset.findUniqueOrThrow({ where: { id: b.assetId } });
        data.categoryId = a.categoryId;
      }
      const after = await tx.maintenanceProgram.update({ where: { id }, data });
      const { asset: _a, ...beforeFlat } = before;
      await this.audit.log(ctx, { action: ruleChanged ? 'CAMBIO_PERIODICIDAD' : 'EDITAR', module: 'programas', entity: 'MaintenanceProgram', entityId: id, ...diff(beforeFlat, after), reason: changeReason ?? null }, tx);
      return after;
    });
  }

  private rule(p: { frequencyType: string; intervalValue: number | null; intervalUnit: string | null; specificDates: string[]; startDate: Date; baseDate: Date; endDate: Date | null }) {
    return {
      frequencyType: p.frequencyType as never,
      intervalValue: p.intervalValue,
      intervalUnit: p.intervalUnit as never,
      specificDates: p.specificDates,
      startDate: fmtYmd(p.startDate),
      baseDate: fmtYmd(p.baseDate),
      endDate: p.endDate ? fmtYmd(p.endDate) : null,
    };
  }

  private present<T extends Parameters<ProgramsController['rule']>[0]>(p: T) {
    let nextDates: string[] = [];
    try {
      nextDates = occurrencesInYear(this.rule(p), currentYearBogota()).slice(0, 24);
    } catch {
      nextDates = [];
    }
    return { ...p, frequencyLabel: describeRule(this.rule(p)), occurrencesThisYear: nextDates.length };
  }
}
