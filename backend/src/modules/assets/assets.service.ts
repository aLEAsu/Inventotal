import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService, diff } from '../../common/audit.service';
import type { ReqCtx } from '../../common/auth.types';
import { CountersService } from '../../common/counters.service';
import { fmtYmd, parseYmd, todayBogota } from '../../common/dates';
import { PrismaService, Tx } from '../../common/prisma.service';
import { areaFilter, assertAreaAccess } from '../../common/scope';
import { SettingsService } from '../../common/settings.service';
import type { AssetStatus, Criticality, Prisma } from '../../generated/prisma/client';
import { computeCriticality } from './criticality';

export interface AssetInput {
  code?: string | null;
  name: string;
  categoryId: string;
  subcategoryId?: string | null;
  description?: string | null;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  locationId?: string | null;
  areaId: string;
  acquisitionDate?: string | null;
  installationDate?: string | null;
  manufacturer?: string | null;
  supplierId?: string | null;
  warrantyUntil?: string | null;
  warrantyInfo?: string | null;
  acquisitionCost?: number | null;
  hostname?: string | null;
  ipAddress?: string | null;
  macAddress?: string | null;
  operatingSystem?: string | null;
  softwareVersion?: string | null;
  processor?: string | null;
  ramGb?: number | null;
  storageGb?: number | null;
  endUser?: string | null;
  licenseExpiresAt?: string | null;
  criticality?: Criticality;
  responsibleId?: string | null;
  notes?: string | null;
}

export const INACTIVE_STATUSES: AssetStatus[] = ['RETIRADO', 'DADO_DE_BAJA'];

const ALLOWED_STATUS_CHANGES: Record<AssetStatus, AssetStatus[]> = {
  OPERATIVO: ['OPERATIVO_CON_OBSERVACIONES', 'EN_MANTENIMIENTO', 'FUERA_DE_SERVICIO', 'RETIRADO', 'DADO_DE_BAJA'],
  OPERATIVO_CON_OBSERVACIONES: ['OPERATIVO', 'EN_MANTENIMIENTO', 'FUERA_DE_SERVICIO', 'RETIRADO', 'DADO_DE_BAJA'],
  EN_MANTENIMIENTO: ['OPERATIVO', 'OPERATIVO_CON_OBSERVACIONES', 'FUERA_DE_SERVICIO', 'RETIRADO', 'DADO_DE_BAJA'],
  FUERA_DE_SERVICIO: ['OPERATIVO', 'OPERATIVO_CON_OBSERVACIONES', 'EN_MANTENIMIENTO', 'RETIRADO', 'DADO_DE_BAJA'],
  RETIRADO: ['OPERATIVO', 'DADO_DE_BAJA'],
  DADO_DE_BAJA: [],
};

const d = (s?: string | null) => (s ? parseYmd(s) : null);

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CountersService,
    private readonly settings: SettingsService,
  ) {}

  async list(ctx: ReqCtx, q: {
    page: number; pageSize: number; q?: string; categoryId?: string; areaId?: string; locationId?: string;
    criticality?: Criticality; status?: AssetStatus; includeInactive?: boolean;
  }) {
    const where: Prisma.AssetWhereInput = {
      ...areaFilter(ctx.user),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.areaId ? { areaId: q.areaId } : {}),
      ...(q.locationId ? { locationId: q.locationId } : {}),
      ...(q.criticality ? { criticality: q.criticality } : {}),
      ...(q.status ? { status: q.status } : !q.includeInactive ? { status: { notIn: INACTIVE_STATUSES } } : {}),
      ...(q.q
        ? {
            OR: [
              { code: { contains: q.q, mode: 'insensitive' } },
              { name: { contains: q.q, mode: 'insensitive' } },
              { serialNumber: { contains: q.q, mode: 'insensitive' } },
              { brand: { contains: q.q, mode: 'insensitive' } },
              { model: { contains: q.q, mode: 'insensitive' } },
              { hostname: { contains: q.q, mode: 'insensitive' } },
              { ipAddress: { contains: q.q } },
              { macAddress: { contains: q.q, mode: 'insensitive' } },
              { endUser: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.asset.findMany({
        where,
        include: {
          category: { select: { id: true, name: true, color: true } },
          area: { select: { id: true, name: true } },
          location: { select: { id: true, name: true } },
          responsible: { select: { id: true, fullName: true } },
        },
        orderBy: { code: 'asc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.asset.count({ where }),
    ]);
    const next = await this.nextMaintenance(items.map((i) => i.id));
    return { items: items.map((a) => ({ ...a, nextMaintenanceDate: next.get(a.id) ?? null })), total };
  }

  /** Próxima fecha comprometida de mantenimiento preventivo pendiente por activo */
  async nextMaintenance(assetIds: string[]): Promise<Map<string, string>> {
    if (!assetIds.length) return new Map();
    const rows = await this.prisma.scheduledActivity.groupBy({
      by: ['assetId'],
      where: { assetId: { in: assetIds }, status: { in: ['PROGRAMADO', 'REPROGRAMADO', 'EN_EJECUCION'] }, committedDate: { gte: parseYmd(todayBogota()) } },
      _min: { committedDate: true },
    });
    return new Map(rows.filter((r) => r._min.committedDate).map((r) => [r.assetId, fmtYmd(r._min.committedDate!)]));
  }

  async get(ctx: ReqCtx, id: string) {
    const a = await this.prisma.asset.findUnique({
      where: { id },
      include: {
        category: true, subcategory: true, area: true, location: true,
        supplier: { select: { id: true, name: true, nit: true } },
        responsible: { select: { id: true, fullName: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
    });
    if (!a) throw new NotFoundException('Activo no encontrado');
    assertAreaAccess(ctx.user, a.areaId);
    const next = await this.nextMaintenance([id]);
    const last = await this.prisma.scheduledActivity.findFirst({
      where: { assetId: id, status: 'EJECUTADO' }, orderBy: { executedDate: 'desc' }, select: { executedDate: true },
    });
    return { ...a, nextMaintenanceDate: next.get(id) ?? null, lastMaintenanceDate: last?.executedDate ? fmtYmd(last.executedDate) : null };
  }

  async create(ctx: ReqCtx, b: AssetInput) {
    assertAreaAccess(ctx.user, b.areaId);
    return this.prisma.$transaction(async (tx) => {
      const cat = await tx.assetCategory.findUnique({ where: { id: b.categoryId } });
      if (!cat || !cat.isActive) throw new BadRequestException('Categoría inválida o inactiva');
      await this.validateRefs(tx, b);
      let code = b.code?.trim().toUpperCase();
      if (!code) {
        const n = await this.counters.next(tx, `ASSET-${cat.code}`, 0);
        code = `${cat.code}-${String(n).padStart(4, '0')}`;
      }
      const a = await tx.asset.create({
        data: {
          ...this.toData(b),
          code,
          categoryId: b.categoryId,
          areaId: b.areaId,
          criticality: b.criticality ?? 'MEDIA',
          createdById: ctx.user.id,
        },
      });
      await this.audit.log(ctx, { action: 'CREAR', module: 'inventario', entity: 'Asset', entityId: a.id, after: a }, tx);
      return a;
    });
  }

  async update(ctx: ReqCtx, id: string, b: Partial<AssetInput>) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.asset.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Activo no encontrado');
      assertAreaAccess(ctx.user, before.areaId);
      if (b.areaId) assertAreaAccess(ctx.user, b.areaId);
      if (before.status === 'DADO_DE_BAJA') throw new ConflictException('Un activo dado de baja no puede modificarse');
      await this.validateRefs(tx, b);
      const data: Prisma.AssetUncheckedUpdateInput = this.toData(b);
      if (b.code !== undefined && b.code) data.code = b.code.trim().toUpperCase();
      if (b.categoryId) data.categoryId = b.categoryId;
      if (b.areaId) data.areaId = b.areaId;
      if (b.criticality) data.criticality = b.criticality;
      const after = await tx.asset.update({ where: { id }, data });
      await this.audit.log(ctx, { action: 'EDITAR', module: 'inventario', entity: 'Asset', entityId: id, ...diff(before, after) }, tx);
      return after;
    });
  }

  /**
   * Cambio de estado controlado. Al dar de baja / retirar:
   * las actividades futuras pendientes pasan a NO_APLICA (se conservan) y los programas se desactivan.
   */
  async changeStatus(ctx: ReqCtx, id: string, status: AssetStatus, reason: string, effectiveDate?: string | null, tx0?: Tx) {
    const run = async (tx: Tx) => {
      const a = await tx.asset.findUnique({ where: { id } });
      if (!a) throw new NotFoundException('Activo no encontrado');
      assertAreaAccess(ctx.user, a.areaId);
      if (a.status === status) return a;
      if (!ALLOWED_STATUS_CHANGES[a.status].includes(status)) {
        throw new ConflictException(`Transición de estado no permitida: ${a.status} → ${status}`);
      }
      const eff = effectiveDate ?? todayBogota();
      const updated = await tx.asset.update({
        where: { id },
        data: {
          status,
          statusReason: reason,
          decommissionedAt: status === 'DADO_DE_BAJA' ? parseYmd(eff) : undefined,
        },
      });
      await tx.assetStatusHistory.create({ data: { assetId: id, fromStatus: a.status, toStatus: status, reason, userId: ctx.user.id } });
      let cancelled = 0;
      if (INACTIVE_STATUSES.includes(status)) {
        const r = await tx.scheduledActivity.updateMany({
          where: { assetId: id, status: { in: ['PROGRAMADO', 'REPROGRAMADO'] }, committedDate: { gte: parseYmd(eff) }, workOrder: null },
          data: { status: 'NO_APLICA', statusReason: `Activo ${status === 'DADO_DE_BAJA' ? 'dado de baja' : 'retirado'}: ${reason}` },
        });
        cancelled = r.count;
        await tx.maintenanceProgram.updateMany({ where: { assetId: id, isActive: true }, data: { isActive: false, endDate: parseYmd(eff) } });
      }
      await this.audit.log(ctx, {
        action: 'CAMBIO_ESTADO', module: 'inventario', entity: 'Asset', entityId: id,
        before: { status: a.status }, after: { status, actividadesNoAplica: cancelled }, reason,
      }, tx);
      return updated;
    };
    return tx0 ? run(tx0) : this.prisma.$transaction(run);
  }

  /** Eliminación física solo si no tiene historial (además lo garantiza un trigger en BD) */
  async remove(ctx: ReqCtx, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.asset.findUniqueOrThrow({ where: { id } });
      assertAreaAccess(ctx.user, a.areaId);
      const [wo, act, fr, docs, prog, hist] = await Promise.all([
        tx.workOrder.count({ where: { assetId: id } }),
        tx.scheduledActivity.count({ where: { assetId: id } }),
        tx.failureReport.count({ where: { assetId: id } }),
        tx.document.count({ where: { assetId: id } }),
        tx.maintenanceProgram.count({ where: { assetId: id } }),
        tx.assetStatusHistory.count({ where: { assetId: id } }),
      ]);
      if (wo + act + fr + docs + prog + hist > 0) {
        throw new ConflictException('El activo tiene historial (programas, actividades, órdenes, fallas o documentos). Use la baja lógica.');
      }
      await tx.criticalityAssessment.deleteMany({ where: { assetId: id } });
      await tx.asset.delete({ where: { id } });
      await this.audit.log(ctx, { action: 'ELIMINAR', module: 'inventario', entity: 'Asset', entityId: id, before: a, reason: 'Registro sin historial (error de captura)' }, tx);
      return { ok: true };
    });
  }

  async assessCriticality(ctx: ReqCtx, id: string, scores: Record<string, number>, justification: string, overrideLevel?: Criticality | null) {
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.asset.findUniqueOrThrow({ where: { id } });
      assertAreaAccess(ctx.user, a.areaId);
      const criteria = await tx.criticalityCriterion.findMany({ where: { isActive: true } });
      if (!criteria.length) throw new BadRequestException('No hay criterios de criticidad configurados');
      const thresholds = await this.settings.get<{ CRITICA: number; ALTA: number; MEDIA: number }>('criticality.thresholds');
      let r;
      try {
        r = computeCriticality(criteria.map((c) => ({ code: c.code, weight: Number(c.weight), maxScore: c.maxScore })), scores, thresholds);
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      const assigned = overrideLevel ?? r.level;
      const ev = await tx.criticalityAssessment.create({
        data: { assetId: id, scores: r.detail, totalScore: r.total, computedLevel: r.level, assignedLevel: assigned, justification, assessedById: ctx.user.id },
      });
      await tx.asset.update({ where: { id }, data: { criticality: assigned } });
      await this.audit.log(ctx, {
        action: 'EVALUAR_CRITICIDAD', module: 'criticidad', entity: 'Asset', entityId: id,
        before: { criticality: a.criticality }, after: { criticality: assigned, computed: r.level, total: r.total }, reason: justification,
      }, tx);
      return ev;
    });
  }

  private async validateRefs(tx: Tx, b: Partial<AssetInput>) {
    if (b.subcategoryId) {
      const s = await tx.assetSubcategory.findUnique({ where: { id: b.subcategoryId } });
      if (!s || (b.categoryId && s.categoryId !== b.categoryId)) throw new BadRequestException('La subcategoría no pertenece a la categoría');
    }
    if (b.acquisitionDate && b.installationDate && b.installationDate < b.acquisitionDate) {
      throw new BadRequestException('La fecha de instalación no puede ser anterior a la de adquisición');
    }
  }

  private toData(b: Partial<AssetInput>) {
    const out: Record<string, unknown> = {};
    const simple = ['name', 'subcategoryId', 'description', 'brand', 'model', 'serialNumber', 'locationId', 'manufacturer', 'supplierId', 'warrantyInfo', 'responsibleId', 'notes', 'acquisitionCost', 'hostname', 'ipAddress', 'macAddress', 'operatingSystem', 'softwareVersion', 'processor', 'ramGb', 'storageGb', 'endUser'] as const;
    for (const k of simple) if (b[k] !== undefined) out[k] = b[k];
    for (const k of ['acquisitionDate', 'installationDate', 'warrantyUntil', 'licenseExpiresAt'] as const) if (b[k] !== undefined) out[k] = d(b[k]);
    return out as Prisma.AssetUncheckedCreateInput;
  }
}
