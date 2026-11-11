import { BadRequestException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService, diff } from '../../common/audit.service';
import type { ReqCtx } from '../../common/auth.types';
import { addDays, fmtYmd, parseYmd, todayBogota } from '../../common/dates';
import { Ctx, Perms } from '../../common/decorators';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { ApiZBody, ApiZQuery, zBoolQ, zMoney, zOptText, zPage, zText, zYmd, ZBody, ZQuery } from '../../common/zod';

const SupplierSchema = z.object({
  name: zText(2, 200),
  nit: z.string().trim().regex(/^[0-9]{5,12}(-[0-9])?$/, 'NIT inválido (ej.: 900123456-7)').optional().nullable().or(z.literal('').transform(() => null)),
  type: z.enum(['INTERNO', 'EXTERNO']).default('EXTERNO'),
  contactName: zOptText(150),
  email: z.string().trim().email('Correo inválido').optional().nullable().or(z.literal('').transform(() => null)),
  phone: zOptText(40),
  specialty: zOptText(200),
  services: zOptText(2000),
  address: zOptText(300),
  isActive: z.boolean().default(true),
});
const ContractSchema = z.object({
  supplierId: z.string().uuid(),
  number: zText(1, 60),
  object: zText(5, 2000),
  startDate: zYmd,
  endDate: zYmd,
  value: zMoney.optional().nullable(),
  status: z.enum(['VIGENTE', 'VENCIDO', 'TERMINADO', 'ANULADO']).default('VIGENTE'),
  notes: zOptText(2000),
  assetIds: z.array(z.string().uuid()).default([]),
});
const EvalSchema = z.object({
  periodStart: zYmd,
  periodEnd: zYmd,
  scores: z.object({
    oportunidad: z.coerce.number().int().min(1).max(5),
    calidad: z.coerce.number().int().min(1).max(5),
    documentacion: z.coerce.number().int().min(1).max(5),
    cumplimientoContractual: z.coerce.number().int().min(1).max(5),
    atencion: z.coerce.number().int().min(1).max(5),
  }),
  observations: zOptText(2000),
});
const ListQ = z.object({ ...zPage, type: z.enum(['INTERNO', 'EXTERNO']).optional(), active: zBoolQ });

@ApiTags('Proveedores y contratos')
@Controller()
export class SuppliersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  @Get('suppliers')
  @Perms('suppliers.read')
  @ApiZQuery(ListQ)
  async list(@ZQuery(ListQ) q: z.infer<typeof ListQ>) {
    const where = {
      ...(q.type ? { type: q.type } : {}),
      ...(q.active !== undefined ? { isActive: q.active } : {}),
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' as const } }, { nit: { contains: q.q } }, { specialty: { contains: q.q, mode: 'insensitive' as const } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where, orderBy: { name: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
        include: { _count: { select: { assets: true, workOrders: true, contracts: true } }, contracts: { where: { status: 'VIGENTE' }, select: { id: true, number: true, endDate: true } } },
      }),
      this.prisma.supplier.count({ where }),
    ]);
    return { items, total };
  }

  @Get('suppliers/options')
  options() {
    return this.prisma.supplier.findMany({ where: { isActive: true }, select: { id: true, name: true, type: true }, orderBy: { name: 'asc' } });
  }

  @Get('suppliers/:id')
  @Perms('suppliers.read')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const s = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        contracts: { include: { assets: { include: { asset: { select: { id: true, code: true, name: true } } } } }, orderBy: { endDate: 'desc' } },
        assets: { select: { id: true, code: true, name: true, status: true } },
        evaluations: { orderBy: { periodEnd: 'desc' } },
        documents: { where: { voidedAt: null }, orderBy: { uploadedAt: 'desc' } },
        workOrders: { select: { id: true, code: true, type: true, status: true, createdAt: true, totalCost: true, asset: { select: { code: true } } }, orderBy: { createdAt: 'desc' }, take: 100 },
      },
    });
    if (!s) throw new NotFoundException('Proveedor no encontrado');
    return s;
  }

  @Post('suppliers')
  @Perms('suppliers.write')
  @ApiZBody(SupplierSchema)
  async create(@Ctx() ctx: ReqCtx, @ZBody(SupplierSchema) b: z.infer<typeof SupplierSchema>) {
    const s = await this.prisma.supplier.create({ data: b });
    await this.audit.log(ctx, { action: 'CREAR', module: 'proveedores', entity: 'Supplier', entityId: s.id, after: s });
    return s;
  }

  @Patch('suppliers/:id')
  @Perms('suppliers.write')
  @ApiZBody(SupplierSchema.partial())
  async update(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(SupplierSchema.partial()) b: Partial<z.infer<typeof SupplierSchema>>) {
    const before = await this.prisma.supplier.findUniqueOrThrow({ where: { id } });
    const s = await this.prisma.supplier.update({ where: { id }, data: b });
    await this.audit.log(ctx, { action: 'EDITAR', module: 'proveedores', entity: 'Supplier', entityId: id, ...diff(before, s) });
    return s;
  }

  // ---------------- Contratos
  @Post('contracts')
  @Perms('suppliers.write')
  @ApiZBody(ContractSchema)
  async createContract(@Ctx() ctx: ReqCtx, @ZBody(ContractSchema) b: z.infer<typeof ContractSchema>) {
    if (b.endDate < b.startDate) throw new BadRequestException('La fecha de vencimiento no puede ser anterior a la de inicio');
    const { assetIds, ...data } = b;
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.contract.create({
        data: { ...data, startDate: parseYmd(b.startDate), endDate: parseYmd(b.endDate), assets: { create: assetIds.map((assetId) => ({ assetId })) } },
      });
      await this.audit.log(ctx, { action: 'CREAR', module: 'proveedores', entity: 'Contract', entityId: c.id, after: { ...c, assetIds } }, tx);
      return c;
    });
  }

  @Patch('contracts/:id')
  @Perms('suppliers.write')
  @ApiZBody(ContractSchema.partial())
  async updateContract(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(ContractSchema.partial()) b: Partial<z.infer<typeof ContractSchema>>) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.contract.findUniqueOrThrow({ where: { id } });
      const { assetIds, ...data } = b;
      const start = b.startDate ?? fmtYmd(before.startDate);
      const end = b.endDate ?? fmtYmd(before.endDate);
      if (end < start) throw new BadRequestException('La fecha de vencimiento no puede ser anterior a la de inicio');
      const c = await tx.contract.update({
        where: { id },
        data: { ...data, startDate: b.startDate ? parseYmd(b.startDate) : undefined, endDate: b.endDate ? parseYmd(b.endDate) : undefined },
      });
      if (assetIds) {
        await tx.contractAsset.deleteMany({ where: { contractId: id } });
        await tx.contractAsset.createMany({ data: assetIds.map((assetId) => ({ contractId: id, assetId })) });
      }
      await this.audit.log(ctx, { action: 'EDITAR', module: 'proveedores', entity: 'Contract', entityId: id, ...diff(before, c) }, tx);
      return c;
    });
  }

  /** Alertas: contratos, garantías y licencias que vencen en los próximos N días (o ya vencidos y aún vigentes) */
  @Get('alerts/expirations')
  @Perms('suppliers.read')
  async expirations() {
    const days = await this.settings.get<number>('contracts.alertDays');
    const today = todayBogota();
    const limit = parseYmd(addDays(today, days));
    const [contracts, warranties, licenses] = await Promise.all([
      this.prisma.contract.findMany({
        where: { status: 'VIGENTE', endDate: { lte: limit } },
        include: { supplier: { select: { id: true, name: true } } },
        orderBy: { endDate: 'asc' },
      }),
      this.prisma.asset.findMany({
        where: { warrantyUntil: { gte: parseYmd(addDays(today, -30)), lte: limit }, status: { notIn: ['DADO_DE_BAJA', 'RETIRADO'] } },
        select: { id: true, code: true, name: true, warrantyUntil: true, supplier: { select: { name: true } } },
        orderBy: { warrantyUntil: 'asc' },
      }),
      this.prisma.asset.findMany({
        where: { licenseExpiresAt: { gte: parseYmd(addDays(today, -30)), lte: limit }, status: { notIn: ['DADO_DE_BAJA', 'RETIRADO'] } },
        select: { id: true, code: true, name: true, licenseExpiresAt: true, softwareVersion: true },
        orderBy: { licenseExpiresAt: 'asc' },
      }),
    ]);
    return {
      days,
      contracts: contracts.map((c) => ({ ...c, startDate: fmtYmd(c.startDate), endDate: fmtYmd(c.endDate), expired: fmtYmd(c.endDate) < today })),
      warranties: warranties.map((w) => ({ ...w, warrantyUntil: fmtYmd(w.warrantyUntil!), expired: fmtYmd(w.warrantyUntil!) < today })),
      licenses: licenses.map((l) => ({ ...l, licenseExpiresAt: fmtYmd(l.licenseExpiresAt!), expired: fmtYmd(l.licenseExpiresAt!) < today })),
    };
  }

  // ---------------- Evaluación de proveedores (F-11)
  @Post('suppliers/:id/evaluations')
  @Perms('suppliers.write')
  @ApiZBody(EvalSchema)
  async evaluate(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(EvalSchema) b: z.infer<typeof EvalSchema>) {
    if (b.periodEnd < b.periodStart) throw new BadRequestException('Periodo inválido');
    const vals = Object.values(b.scores);
    const total = Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100;
    const e = await this.prisma.supplierEvaluation.create({
      data: { supplierId: id, periodStart: parseYmd(b.periodStart), periodEnd: parseYmd(b.periodEnd), scores: b.scores, totalScore: total, observations: b.observations ?? null, evaluatedById: ctx.user.id },
    });
    await this.audit.log(ctx, { action: 'EVALUAR_PROVEEDOR', module: 'proveedores', entity: 'SupplierEvaluation', entityId: e.id, after: e });
    return e;
  }
}
