import { BadRequestException, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import * as QRCode from 'qrcode';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import type { ReqCtx } from '../../common/auth.types';
import { Ctx, Perms } from '../../common/decorators';
import { PrismaService } from '../../common/prisma.service';
import { assertAreaAccess } from '../../common/scope';
import { SettingsService } from '../../common/settings.service';
import { ApiZBody, ApiZQuery, zBoolQ, zOptText, zOptUuid, zOptYmd, zPage, zReason, ZBody, ZQuery } from '../../common/zod';
import { AssetsService } from './assets.service';

const CRIT = z.enum(['CRITICA', 'ALTA', 'MEDIA', 'BAJA']);
const STATUS = z.enum(['OPERATIVO', 'OPERATIVO_CON_OBSERVACIONES', 'EN_MANTENIMIENTO', 'FUERA_DE_SERVICIO', 'RETIRADO', 'DADO_DE_BAJA']);

const AssetSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9._/-]{2,40}$/, 'Código: 2-40 caracteres (A-Z, 0-9, . _ - /)').optional().nullable().or(z.literal('').transform(() => null)),
  name: z.string().trim().min(2, 'Ingrese el nombre').max(200),
  categoryId: z.string().uuid('Seleccione la categoría'),
  subcategoryId: zOptUuid,
  description: zOptText(2000),
  brand: zOptText(100),
  model: zOptText(100),
  serialNumber: zOptText(100),
  locationId: zOptUuid,
  areaId: z.string().uuid('Seleccione el área responsable'),
  acquisitionDate: zOptYmd,
  installationDate: zOptYmd,
  manufacturer: zOptText(150),
  supplierId: zOptUuid,
  warrantyUntil: zOptYmd,
  warrantyInfo: zOptText(1000),
  acquisitionCost: z.coerce.number().min(0).max(999_999_999_999).optional().nullable(),
  hostname: z.string().trim().regex(/^[A-Za-z0-9._-]{1,63}$/, 'Hostname inválido').optional().nullable().or(z.literal('').transform(() => null)),
  ipAddress: z.union([z.ipv4('Dirección IP inválida'), z.ipv6('Dirección IP inválida'), z.literal(''), z.null()]).optional().transform((v) => (v ? v : null)),
  macAddress: z.string().trim().toUpperCase().regex(/^([0-9A-F]{2}[:-]){5}[0-9A-F]{2}$/, 'MAC inválida (ej. 00:1A:2B:3C:4D:5E)').optional().nullable().or(z.literal('').transform(() => null)),
  operatingSystem: zOptText(120),
  softwareVersion: zOptText(120),
  processor: zOptText(120),
  ramGb: z.coerce.number().int().min(0).max(100000).optional().nullable(),
  storageGb: z.coerce.number().int().min(0).max(10_000_000).optional().nullable(),
  endUser: zOptText(150),
  licenseExpiresAt: zOptYmd,
  criticality: CRIT.optional(),
  responsibleId: zOptUuid,
  notes: zOptText(4000),
});
const AssetUpdate = AssetSchema.partial();
const AssetQuery = z.object({
  ...zPage,
  categoryId: z.string().uuid().optional(),
  areaId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  criticality: CRIT.optional(),
  status: STATUS.optional(),
  includeInactive: zBoolQ,
});
const StatusSchema = z.object({ status: STATUS, reason: zReason, effectiveDate: zOptYmd });
const AssessSchema = z.object({
  scores: z.record(z.string(), z.coerce.number().int()),
  justification: zReason,
  overrideLevel: CRIT.optional().nullable(),
});
const CriterionSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,30}$/),
  name: z.string().trim().min(3).max(150),
  description: zOptText(1000),
  weight: z.coerce.number().min(0).max(100),
  maxScore: z.coerce.number().int().min(2).max(10).default(5),
  scaleGuide: z.array(z.string().max(300)).optional().nullable(),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
});

@ApiTags('Inventario de activos')
@Controller()
export class AssetsController {
  constructor(
    private readonly svc: AssetsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  @Get('assets')
  @Perms('assets.read')
  @ApiZQuery(AssetQuery)
  list(@Ctx() ctx: ReqCtx, @ZQuery(AssetQuery) q: z.infer<typeof AssetQuery>) {
    return this.svc.list(ctx, q);
  }

  /** Selector liviano para formularios (reporte de fallas, programas) */
  @Get('assets/options')
  async options(@Ctx() ctx: ReqCtx) {
    const where = ctx.user.scope === 'AREA' ? { areaId: { in: ctx.user.areaIds } } : {};
    return this.prisma.asset.findMany({
      where: { ...where, status: { notIn: ['DADO_DE_BAJA', 'RETIRADO'] } },
      select: { id: true, code: true, name: true, areaId: true, categoryId: true, criticality: true, status: true, location: { select: { name: true } } },
      orderBy: { code: 'asc' },
    });
  }

  @Get('assets/:id')
  @Perms('assets.read')
  get(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ctx, id);
  }

  @Post('assets')
  @Perms('assets.write')
  @ApiZBody(AssetSchema)
  create(@Ctx() ctx: ReqCtx, @ZBody(AssetSchema) b: z.infer<typeof AssetSchema>) {
    return this.svc.create(ctx, b);
  }

  @Patch('assets/:id')
  @Perms('assets.write')
  @ApiZBody(AssetUpdate)
  update(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(AssetUpdate) b: z.infer<typeof AssetUpdate>) {
    return this.svc.update(ctx, id, b);
  }

  @Post('assets/:id/status')
  @Perms('assets.status')
  @ApiZBody(StatusSchema)
  status(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(StatusSchema) b: z.infer<typeof StatusSchema>) {
    return this.svc.changeStatus(ctx, id, b.status, b.reason, b.effectiveDate);
  }

  @Delete('assets/:id')
  @Perms('assets.write', 'assets.status')
  remove(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(ctx, id);
  }

  @Get('assets/:id/status-history')
  @Perms('assets.read')
  async statusHistory(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    const a = await this.prisma.asset.findUniqueOrThrow({ where: { id } });
    assertAreaAccess(ctx.user, a.areaId);
    return this.prisma.assetStatusHistory.findMany({ where: { assetId: id }, orderBy: { createdAt: 'desc' } });
  }

  /** Código QR que enlaza a la hoja de vida del activo */
  @Get('assets/:id/qr')
  @Perms('assets.read')
  async qr(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const a = await this.prisma.asset.findUniqueOrThrow({ where: { id }, select: { id: true, code: true } });
    const base = String(await this.settings.get('app.publicUrl')).replace(/\/$/, '');
    const png = await QRCode.toBuffer(`${base}/activos/${a.id}`, { type: 'png', width: 360, margin: 2, errorCorrectionLevel: 'M' });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="QR-${a.code}.png"`);
    res.send(png);
  }

  // ---------------- Criticidad
  @Get('criticality/criteria')
  @Perms('assets.read')
  criteria() {
    return this.prisma.criticalityCriterion.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  }

  @Post('criticality/criteria')
  @Perms('criticality.configure')
  @ApiZBody(CriterionSchema)
  async createCriterion(@Ctx() ctx: ReqCtx, @ZBody(CriterionSchema) b: z.infer<typeof CriterionSchema>) {
    const r = await this.prisma.criticalityCriterion.create({ data: { ...b, scaleGuide: b.scaleGuide ?? undefined } });
    await this.audit.log(ctx, { action: 'CREAR', module: 'criticidad', entity: 'CriticalityCriterion', entityId: r.id, after: r });
    return r;
  }

  @Put('criticality/criteria/:id')
  @Perms('criticality.configure')
  @ApiZBody(CriterionSchema.partial())
  async updateCriterion(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(CriterionSchema.partial()) b: Partial<z.infer<typeof CriterionSchema>>) {
    const before = await this.prisma.criticalityCriterion.findUniqueOrThrow({ where: { id } });
    const r = await this.prisma.criticalityCriterion.update({ where: { id }, data: { ...b, scaleGuide: b.scaleGuide ?? undefined } });
    await this.audit.log(ctx, { action: 'EDITAR', module: 'criticidad', entity: 'CriticalityCriterion', entityId: id, before, after: r });
    return r;
  }

  @Get('assets/:id/criticality')
  @Perms('assets.read')
  async assessments(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    const a = await this.prisma.asset.findUniqueOrThrow({ where: { id } });
    assertAreaAccess(ctx.user, a.areaId);
    return this.prisma.criticalityAssessment.findMany({ where: { assetId: id }, orderBy: { assessedAt: 'desc' } });
  }

  @Post('assets/:id/criticality')
  @Perms('criticality.assess')
  @ApiZBody(AssessSchema)
  assess(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(AssessSchema) b: z.infer<typeof AssessSchema>) {
    if (b.overrideLevel && b.justification.length < 20) {
      throw new BadRequestException('Para asignar un nivel distinto al calculado documente una justificación de al menos 20 caracteres');
    }
    return this.svc.assessCriticality(ctx, id, b.scores, b.justification, b.overrideLevel);
  }
}
