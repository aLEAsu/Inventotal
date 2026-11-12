import { BadRequestException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import type { ReqCtx } from '../../common/auth.types';
import { Ctx, Perms } from '../../common/decorators';
import { PrismaService, Tx } from '../../common/prisma.service';
import { areaFilter, assertAreaAccess } from '../../common/scope';
import { ApiZBody, zOptText, zText, ZBody } from '../../common/zod';
import { INACTIVE_STATUSES } from '../assets/assets.service';

const GroupInput = z.object({
  name: zText(2, 100),
  description: zOptText(1000),
  assetIds: z.array(z.string().uuid()).min(1).max(500),
  isActive: z.boolean().optional(),
});

@Controller('maintenance-groups')
export class MaintenanceGroupsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get()
  @Perms('programs.read')
  async list(@Ctx() ctx: ReqCtx) {
    const groups = await this.prisma.maintenanceGroup.findMany({
      where: { assets: { some: { asset: areaFilter(ctx.user) } } },
      include: {
        assets: {
          where: { asset: areaFilter(ctx.user) },
          include: { asset: { select: { id: true, code: true, name: true, status: true, categoryId: true, subcategoryId: true } } },
          orderBy: { asset: { code: 'asc' } },
        },
      },
      orderBy: { name: 'asc' },
    });
    return groups.map((group) => ({ ...group, assetCount: group.assets.length, assetIds: group.assets.map((m) => m.assetId) }));
  }

  @Post()
  @Perms('programs.write')
  @ApiZBody(GroupInput)
  async create(@Ctx() ctx: ReqCtx, @ZBody(GroupInput) body: z.infer<typeof GroupInput>) {
    return this.prisma.$transaction(async (tx) => {
      const assets = await this.requireAssets(ctx, body.assetIds, tx);
      const group = await tx.maintenanceGroup.create({
        data: {
          name: body.name,
          description: body.description ?? null,
          createdById: ctx.user.id,
          assets: { create: assets.map((asset) => ({ assetId: asset.id })) },
        },
        include: { assets: { include: { asset: { select: { id: true, code: true, name: true, status: true } } } } },
      });
      await this.audit.log(ctx, { action: 'CREAR', module: 'programas', entity: 'MaintenanceGroup', entityId: group.id, after: group }, tx);
      return { ...group, assetIds: group.assets.map((member) => member.assetId), assetCount: group.assets.length };
    });
  }

  @Patch(':id')
  @Perms('programs.write')
  @ApiZBody(GroupInput.partial())
  async update(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(GroupInput.partial()) body: Partial<z.infer<typeof GroupInput>>) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.maintenanceGroup.findUnique({ where: { id }, include: { assets: { include: { asset: { select: { areaId: true } } } } } });
      if (!before) throw new NotFoundException('Agrupación no encontrada');
      for (const member of before.assets) assertAreaAccess(ctx.user, member.asset.areaId);
      const assets = body.assetIds === undefined ? null : await this.requireAssets(ctx, body.assetIds, tx);
      if (assets && body.assetIds!.length !== assets.length) throw new BadRequestException('La agrupación solo puede incluir activos existentes y habilitados');
      const after = await tx.maintenanceGroup.update({
        where: { id },
        data: {
          name: body.name,
          description: body.description,
          isActive: body.isActive,
          ...(assets ? {
            assets: {
              deleteMany: {},
              create: assets.map((asset) => ({ assetId: asset.id })),
            },
          } : {}),
        },
        include: { assets: { include: { asset: { select: { id: true, code: true, name: true, status: true } } } } },
      });
      await this.audit.log(ctx, { action: 'EDITAR', module: 'programas', entity: 'MaintenanceGroup', entityId: id, before, after }, tx);
      return { ...after, assetIds: after.assets.map((member) => member.assetId), assetCount: after.assets.length };
    });
  }

  private async requireAssets(ctx: ReqCtx, ids: string[], tx: Tx) {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length !== ids.length) throw new BadRequestException('No repita activos en una agrupación');
    const assets = await tx.asset.findMany({ where: { id: { in: uniqueIds } }, select: { id: true, areaId: true, status: true } });
    for (const asset of assets) assertAreaAccess(ctx.user, asset.areaId);
    if (assets.length !== uniqueIds.length || assets.some((asset) => INACTIVE_STATUSES.includes(asset.status))) {
      throw new BadRequestException('La agrupación solo puede incluir activos existentes y habilitados');
    }
    return assets;
  }
}
