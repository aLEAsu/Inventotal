import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService, diff } from '../../common/audit.service';
import type { ReqCtx } from '../../common/auth.types';
import { Ctx, Perms } from '../../common/decorators';
import { PrismaService } from '../../common/prisma.service';
import { DEFAULT_SETTINGS, SettingsService } from '../../common/settings.service';
import { ApiZBody, zOptText, zOptUuid, ZBody } from '../../common/zod';
import { INACTIVE_STATUSES } from '../assets/assets.service';

const code = z.string().trim().toUpperCase().regex(/^[A-Z0-9._-]{1,20}$/, 'Código: 1-20 caracteres (A-Z, 0-9, . _ -)');
const AreaSchema = z.object({ code, name: z.string().trim().min(2).max(120), description: zOptText(500), isActive: z.boolean().default(true) });
const LocationSchema = z.object({
  code, name: z.string().trim().min(2).max(150), building: zOptText(80), floor: zOptText(40), areaId: zOptUuid, isActive: z.boolean().default(true),
});
const CategorySchema = z.object({
  code, name: z.string().trim().min(2).max(120), description: zOptText(500),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(), isActive: z.boolean().default(true),
});
const SubcategorySchema = z.object({ categoryId: z.string().uuid(), name: z.string().trim().min(2).max(120), isActive: z.boolean().default(true) });
const SettingSchema = z.object({ value: z.unknown() });

@ApiTags('Configuración')
@Controller()
export class CatalogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  // --- Lecturas: disponibles para cualquier usuario autenticado (alimentan selectores)
  @Get('areas')
  areas() {
    return this.prisma.area.findMany({ orderBy: { name: 'asc' } });
  }
  @Get('locations')
  locations() {
    return this.prisma.location.findMany({ include: { area: { select: { id: true, name: true } } }, orderBy: { name: 'asc' } });
  }
  @Get('categories')
  async categories() {
    // assetCount: equipos habilitados (no retirados ni dados de baja), útil para definir programas por grupo
    const active = { where: { status: { notIn: INACTIVE_STATUSES } } };
    const rows = await this.prisma.assetCategory.findMany({
      include: { _count: { select: { assets: active } }, subcategories: { orderBy: { name: 'asc' }, include: { _count: { select: { assets: active } } } } },
      orderBy: { name: 'asc' },
    });
    return rows.map(({ _count, subcategories, ...c }) => ({
      ...c, assetCount: _count.assets,
      subcategories: subcategories.map(({ _count: sc, ...s }) => ({ ...s, assetCount: sc.assets })),
    }));
  }

  /** Parámetros públicos de identidad institucional (para encabezados) */
  @Get('settings/public')
  async publicSettings() {
    const keys = ['institution.name', 'institution.nit', 'institution.address', 'institution.city', 'institution.primaryColor', 'institution.shortName', 'schedule.upcomingDays', 'app.publicUrl'];
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = await this.settings.get(k);
    return out;
  }

  // --- Escrituras
  @Post('areas')
  @Perms('catalog.manage')
  @ApiZBody(AreaSchema)
  createArea(@Ctx() ctx: ReqCtx, @ZBody(AreaSchema) b: z.infer<typeof AreaSchema>) {
    return this.createAudited(ctx, 'Area', () => this.prisma.area.create({ data: b }));
  }
  @Patch('areas/:id')
  @Perms('catalog.manage')
  @ApiZBody(AreaSchema.partial())
  updateArea(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(AreaSchema.partial()) b: Partial<z.infer<typeof AreaSchema>>) {
    return this.updateAudited(ctx, 'Area', id, () => this.prisma.area.findUniqueOrThrow({ where: { id } }), () => this.prisma.area.update({ where: { id }, data: b }));
  }
  @Post('locations')
  @Perms('catalog.manage')
  @ApiZBody(LocationSchema)
  createLocation(@Ctx() ctx: ReqCtx, @ZBody(LocationSchema) b: z.infer<typeof LocationSchema>) {
    return this.createAudited(ctx, 'Location', () => this.prisma.location.create({ data: b }));
  }
  @Patch('locations/:id')
  @Perms('catalog.manage')
  @ApiZBody(LocationSchema.partial())
  updateLocation(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(LocationSchema.partial()) b: Partial<z.infer<typeof LocationSchema>>) {
    return this.updateAudited(ctx, 'Location', id, () => this.prisma.location.findUniqueOrThrow({ where: { id } }), () => this.prisma.location.update({ where: { id }, data: b }));
  }
  @Post('categories')
  @Perms('catalog.manage')
  @ApiZBody(CategorySchema)
  createCategory(@Ctx() ctx: ReqCtx, @ZBody(CategorySchema) b: z.infer<typeof CategorySchema>) {
    return this.createAudited(ctx, 'AssetCategory', () => this.prisma.assetCategory.create({ data: b }));
  }
  @Patch('categories/:id')
  @Perms('catalog.manage')
  @ApiZBody(CategorySchema.partial())
  updateCategory(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(CategorySchema.partial()) b: Partial<z.infer<typeof CategorySchema>>) {
    return this.updateAudited(ctx, 'AssetCategory', id, () => this.prisma.assetCategory.findUniqueOrThrow({ where: { id } }), () => this.prisma.assetCategory.update({ where: { id }, data: b }));
  }
  @Post('subcategories')
  @Perms('catalog.manage')
  @ApiZBody(SubcategorySchema)
  createSub(@Ctx() ctx: ReqCtx, @ZBody(SubcategorySchema) b: z.infer<typeof SubcategorySchema>) {
    return this.createAudited(ctx, 'AssetSubcategory', () => this.prisma.assetSubcategory.create({ data: b }));
  }
  @Patch('subcategories/:id')
  @Perms('catalog.manage')
  @ApiZBody(SubcategorySchema.partial())
  updateSub(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(SubcategorySchema.partial()) b: Partial<z.infer<typeof SubcategorySchema>>) {
    return this.updateAudited(ctx, 'AssetSubcategory', id, () => this.prisma.assetSubcategory.findUniqueOrThrow({ where: { id } }), () => this.prisma.assetSubcategory.update({ where: { id }, data: b }));
  }

  // --- Parámetros del sistema
  @Get('settings')
  @Perms('settings.manage')
  allSettings() {
    return this.settings.all();
  }
  @Put('settings/:key')
  @Perms('settings.manage')
  @ApiZBody(SettingSchema)
  async setSetting(@Ctx() ctx: ReqCtx, @Param('key') key: string, @ZBody(SettingSchema) b: { value: unknown }) {
    const def = DEFAULT_SETTINGS[key];
    if (!def) throw new BadRequestException('Parámetro desconocido');
    if (typeof def.value !== typeof b.value || Array.isArray(def.value) !== Array.isArray(b.value)) {
      throw new BadRequestException(`El valor debe ser de tipo ${Array.isArray(def.value) ? 'lista' : typeof def.value}`);
    }
    const before = await this.settings.get(key);
    const r = await this.settings.set(key, b.value, ctx.user.id);
    await this.audit.log(ctx, { action: 'EDITAR', module: 'configuracion', entity: 'Setting', entityId: key, before: { value: before }, after: { value: b.value } });
    return r;
  }

  private async createAudited<T extends { id: string }>(ctx: ReqCtx, entity: string, fn: () => Promise<T>) {
    const r = await fn();
    await this.audit.log(ctx, { action: 'CREAR', module: 'configuracion', entity, entityId: r.id, after: r });
    return r;
  }
  private async updateAudited<T extends Record<string, unknown>>(ctx: ReqCtx, entity: string, id: string, get: () => Promise<T>, fn: () => Promise<T>) {
    const before = await get();
    const r = await fn();
    await this.audit.log(ctx, { action: 'EDITAR', module: 'configuracion', entity, entityId: id, ...diff(before, r) });
    return r;
  }
}
