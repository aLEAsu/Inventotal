import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { ReqCtx } from '../../common/auth.types';
import { AnyPerms, Ctx, Perms } from '../../common/decorators';
import { ApiZBody, ApiZQuery, zBoolQ, zOptText, zOptUuid, zOptYmd, zPage, zReason, zText, ZBody, ZQuery } from '../../common/zod';
import { PrismaService } from '../../common/prisma.service';
import { FailuresService } from './failures.service';

const PRIORITY = z.enum(['URGENTE', 'ALTA', 'MEDIA', 'BAJA']);
const score = z.coerce.number().int().min(1, '1 a 5').max(5, '1 a 5');
const Report = z.object({
  assetId: z.string().uuid('Seleccione el activo afectado'),
  title: zText(3, 200),
  description: zText(10, 4000),
  assetCondition: z.enum(['FUNCIONA_NORMAL', 'FUNCIONA_CON_LIMITACIONES', 'NO_FUNCIONA', 'RIESGO_SEGURIDAD']),
  serviceImpact: zOptText(1000),
  safety: score,
  care: score,
  continuity: score,
  observations: zOptText(2000),
  markOutOfService: z.boolean().optional(),
});
const ListQ = z.object({
  ...zPage,
  status: z.enum(['REPORTADA', 'EN_EVALUACION', 'ASIGNADA', 'EN_ATENCION', 'RESUELTA', 'CERRADA', 'ANULADA']).optional(),
  priority: PRIORITY.optional(),
  assetId: z.string().uuid().optional(),
  areaId: z.string().uuid().optional(),
  open: zBoolQ,
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const Evaluate = z.object({
  safety: score.optional(), care: score.optional(), continuity: score.optional(),
  priority: PRIORITY.optional().nullable(), overrideReason: zOptText(1000), markOutOfService: z.boolean().optional(), note: zOptText(2000),
});
const Assign = z.object({ assignedToId: z.string().uuid('Seleccione el responsable'), supplierId: zOptUuid, note: zOptText(1000), dueDate: zOptYmd });
const PriorityPreview = z.object({ assetId: z.string().uuid(), safety: score, care: score, continuity: score });

@ApiTags('Mantenimiento correctivo')
@Controller('failures')
export class FailuresController {
  constructor(
    private readonly svc: FailuresService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @AnyPerms('failures.read', 'failures.read_all')
  @ApiZQuery(ListQ)
  list(@Ctx() ctx: ReqCtx, @ZQuery(ListQ) q: z.infer<typeof ListQ>) {
    return this.svc.list(ctx, q);
  }

  @Get('recurring')
  @Perms('failures.read_all')
  recurring(@Ctx() ctx: ReqCtx) {
    return this.svc.recurring(ctx);
  }

  @Post('priority-preview')
  @Perms('failures.report')
  @ApiZBody(PriorityPreview)
  async preview(@ZBody(PriorityPreview) b: z.infer<typeof PriorityPreview>) {
    const a = await this.prisma.asset.findUniqueOrThrow({ where: { id: b.assetId } });
    return this.svc.priorityFor(b, a.criticality);
  }

  @Get(':id')
  @AnyPerms('failures.read', 'failures.read_all')
  get(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ctx, id);
  }

  @Post()
  @Perms('failures.report')
  @ApiZBody(Report)
  report(@Ctx() ctx: ReqCtx, @ZBody(Report) b: z.infer<typeof Report>) {
    return this.svc.report(ctx, b);
  }

  @Post(':id/evaluate')
  @Perms('failures.manage')
  @ApiZBody(Evaluate)
  evaluate(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(Evaluate) b: z.infer<typeof Evaluate>) {
    return this.svc.evaluate(ctx, id, b);
  }

  @Post(':id/assign')
  @Perms('failures.manage', 'workorders.assign')
  @ApiZBody(Assign)
  assign(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(Assign) b: z.infer<typeof Assign>) {
    return this.svc.assign(ctx, id, b);
  }

  @Post(':id/release')
  @Perms('failures.release')
  @ApiZBody(z.object({ note: zReason }))
  release(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(z.object({ note: zReason })) b: { note: string }) {
    return this.svc.release(ctx, id, b.note);
  }

  @Post(':id/close')
  @Perms('failures.manage')
  @ApiZBody(z.object({ note: zReason }))
  close(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(z.object({ note: zReason })) b: { note: string }) {
    return this.svc.close(ctx, id, b.note);
  }

  @Post(':id/cancel')
  @Perms('failures.manage')
  @ApiZBody(z.object({ reason: zReason }))
  cancel(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(z.object({ reason: zReason })) b: { reason: string }) {
    return this.svc.cancel(ctx, id, b.reason);
  }
}
