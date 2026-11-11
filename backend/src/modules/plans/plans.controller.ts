import { Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import type { ReqCtx } from '../../common/auth.types';
import { AnyPerms, Ctx, Perms } from '../../common/decorators';
import { ApiZBody, ApiZQuery, zOptText, zOptUuid, zReason, zYmd, ZBody, ZQuery } from '../../common/zod';
import { PlanExportService } from './plan-export.service';
import { PlansService } from './plans.service';

const DSTATUS = z.enum(['PROGRAMADO', 'PROXIMO', 'EN_EJECUCION', 'EJECUTADO', 'VENCIDO', 'REPROGRAMADO', 'CANCELADO', 'NO_APLICA']);
const Filters = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  areaId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  assetId: z.string().uuid().optional(),
  responsibleId: z.string().uuid().optional(),
  criticality: z.enum(['CRITICA', 'ALTA', 'MEDIA', 'BAJA']).optional(),
  status: DSTATUS.optional(),
  kind: z.enum(['PREVENTIVO', 'INSPECCION', 'CALIBRACION', 'VERIFICACION_METROLOGICA', 'LIMPIEZA', 'PRUEBA_FUNCIONAL', 'OTRO']).optional(),
  q: z.string().trim().max(100).optional(),
});
const ListQuery = Filters.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(100),
  sort: z.enum(['committedDate', 'asset', 'area', 'responsible']).default('committedDate'),
  dir: z.enum(['asc', 'desc']).default('asc'),
});
const ExportQuery = Filters.extend({ paper: z.enum(['a4', 'a3']).default('a4') });
const CreatePlan = z.object({ notes: zOptText(2000) });
const Generate = z.object({ reason: zOptText(2000) });
const Transition = z.object({ reason: zOptText(2000) });
const RescheduleReq = z.object({ toDate: zYmd, reason: zReason, autoApprove: z.boolean().default(false) });
const Decision = z.object({ approve: z.boolean(), note: zOptText(2000) });
const ActStatus = z.object({ status: z.enum(['CANCELADO', 'NO_APLICA', 'PROGRAMADO']), reason: zReason });
const Assign = z.object({ responsibleId: zOptUuid });

@ApiTags('Cronograma anual')
@Controller()
export class PlansController {
  constructor(
    private readonly svc: PlansService,
    private readonly exporter: PlanExportService,
    private readonly audit: AuditService,
  ) {}

  /** Año actual según la fecha del servidor en America/Bogota (nunca codificado) */
  @Get('plans/current-year')
  currentYear() {
    return this.svc.currentYear();
  }

  @Get('plans')
  @Perms('plans.read')
  list() {
    return this.svc.listPlans();
  }

  @Get('plans/:year')
  @Perms('plans.read')
  async get(@Param('year', ParseIntPipe) year: number) {
    return { year, plan: await this.svc.getPlan(year) };
  }

  @Post('plans/:year')
  @Perms('plans.generate')
  @ApiZBody(CreatePlan)
  create(@Ctx() ctx: ReqCtx, @Param('year', ParseIntPipe) year: number, @ZBody(CreatePlan) b: z.infer<typeof CreatePlan>) {
    return this.svc.createPlan(ctx, year, b.notes);
  }

  @Post('plans/:year/generate')
  @Perms('plans.generate')
  @ApiZBody(Generate)
  generate(@Ctx() ctx: ReqCtx, @Param('year', ParseIntPipe) year: number, @ZBody(Generate) b: z.infer<typeof Generate>) {
    return this.svc.generate(ctx, year, b.reason);
  }

  @Post('plans/:year/submit')
  @Perms('plans.submit')
  submit(@Ctx() ctx: ReqCtx, @Param('year', ParseIntPipe) year: number, @ZBody(Transition) b: z.infer<typeof Transition>) {
    return this.svc.transition(ctx, year, 'SUBMIT', b.reason);
  }
  @Post('plans/:year/review')
  @Perms('plans.approve')
  review(@Ctx() ctx: ReqCtx, @Param('year', ParseIntPipe) year: number, @ZBody(Transition) b: z.infer<typeof Transition>) {
    return this.svc.transition(ctx, year, 'REVIEW', b.reason);
  }
  @Post('plans/:year/return')
  @Perms('plans.approve')
  returnToDraft(@Ctx() ctx: ReqCtx, @Param('year', ParseIntPipe) year: number, @ZBody(Transition) b: z.infer<typeof Transition>) {
    return this.svc.transition(ctx, year, 'RETURN', b.reason);
  }
  @Post('plans/:year/approve')
  @Perms('plans.approve')
  approve(@Ctx() ctx: ReqCtx, @Param('year', ParseIntPipe) year: number, @ZBody(Transition) b: z.infer<typeof Transition>) {
    return this.svc.transition(ctx, year, 'APPROVE', b.reason);
  }
  @Post('plans/:year/close')
  @Perms('plans.close')
  close(@Ctx() ctx: ReqCtx, @Param('year', ParseIntPipe) year: number, @ZBody(Transition) b: z.infer<typeof Transition>) {
    return this.svc.transition(ctx, year, 'CLOSE', b.reason);
  }

  @Get('plans/:year/activities')
  @Perms('plans.read')
  @ApiZQuery(ListQuery)
  activities(@Ctx() ctx: ReqCtx, @Param('year', ParseIntPipe) year: number, @ZQuery(ListQuery) q: z.infer<typeof ListQuery>) {
    const { page, pageSize, sort, dir, ...f } = q;
    return this.svc.activities(ctx, year, f, page, pageSize, sort, dir);
  }

  @Get('plans/:year/matrix')
  @Perms('plans.read')
  @ApiZQuery(Filters)
  matrix(@Ctx() ctx: ReqCtx, @Param('year', ParseIntPipe) year: number, @ZQuery(Filters) f: z.infer<typeof Filters>) {
    return this.svc.matrix(ctx, year, f);
  }

  @Get('plans/:year/summary')
  @Perms('plans.read')
  @ApiZQuery(Filters)
  summary(@Ctx() ctx: ReqCtx, @Param('year', ParseIntPipe) year: number, @ZQuery(Filters) f: z.infer<typeof Filters>) {
    return this.svc.summary(ctx, year, f);
  }

  @Get('plans/:year/history')
  @Perms('plans.read')
  history(@Param('year', ParseIntPipe) year: number) {
    return this.svc.history(year);
  }

  @Get('plans/:year/export.pdf')
  @Perms('plans.export')
  @ApiZQuery(ExportQuery)
  async exportPdf(@Ctx() ctx: ReqCtx, @Param('year', ParseIntPipe) year: number, @ZQuery(ExportQuery) q: z.infer<typeof ExportQuery>, @Res() res: Response) {
    const { paper, ...f } = q;
    const buf = await this.exporter.pdf(ctx, year, f, paper);
    await this.audit.log(ctx, { action: 'EXPORTAR_PDF', module: 'cronograma', entity: 'AnnualPlan', entityId: String(year), after: { filtros: f, paper, bytes: buf.length } });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Plan_Anual_Mantenimiento_${year}.pdf"`);
    res.send(buf);
  }

  @Get('plans/:year/export.xlsx')
  @Perms('plans.export')
  @ApiZQuery(Filters)
  async exportXlsx(@Ctx() ctx: ReqCtx, @Param('year', ParseIntPipe) year: number, @ZQuery(Filters) f: z.infer<typeof Filters>, @Res() res: Response) {
    const buf = await this.exporter.xlsx(ctx, year, f);
    await this.audit.log(ctx, { action: 'EXPORTAR_EXCEL', module: 'cronograma', entity: 'AnnualPlan', entityId: String(year), after: { filtros: f, bytes: buf.length } });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Plan_Anual_Mantenimiento_${year}.xlsx"`);
    res.send(buf);
  }

  // ---------------------------------------------------------------- Actividades
  @Get('activities/:id')
  @Perms('plans.read')
  activity(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getActivity(ctx, id);
  }

  @Post('activities/:id/reschedule')
  @Perms('schedule.reschedule')
  @ApiZBody(RescheduleReq)
  reschedule(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(RescheduleReq) b: z.infer<typeof RescheduleReq>) {
    return this.svc.requestReschedule(ctx, id, b.toDate, b.reason, b.autoApprove);
  }

  @Post('activities/:id/status')
  @AnyPerms('plans.generate', 'plans.approve')
  @ApiZBody(ActStatus)
  setStatus(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(ActStatus) b: z.infer<typeof ActStatus>) {
    return this.svc.setActivityStatus(ctx, id, b.status, b.reason);
  }

  @Post('activities/:id/assign')
  @Perms('schedule.assign')
  @ApiZBody(Assign)
  assign(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(Assign) b: z.infer<typeof Assign>) {
    return this.svc.assignResponsible(ctx, id, b.responsibleId);
  }

  @Get('reschedules/pending')
  @Perms('plans.read')
  pending(@Ctx() ctx: ReqCtx) {
    return this.svc.pendingReschedules(ctx);
  }

  @Post('reschedules/:id/decide')
  @Perms('plans.approve')
  @ApiZBody(Decision)
  decide(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(Decision) b: z.infer<typeof Decision>) {
    return this.svc.decideReschedule(ctx, id, b.approve, b.note);
  }
}
