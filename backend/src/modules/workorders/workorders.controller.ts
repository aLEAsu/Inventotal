import { Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import type { ReqCtx } from '../../common/auth.types';
import { Ctx, Perms, AnyPerms } from '../../common/decorators';
import { ApiZBody, ApiZQuery, zBoolQ, zMoney, zOptText, zOptUuid, zOptYmd, zPage, zReason, zText, ZBody, ZQuery } from '../../common/zod';
import { FailuresService } from '../failures/failures.service';
import { ReportsService } from '../reports/reports.service';
import { WorkOrdersService } from './workorders.service';

const PRIORITY = z.enum(['URGENTE', 'ALTA', 'MEDIA', 'BAJA']);
const WSTATUS = z.enum(['ABIERTA', 'ASIGNADA', 'EN_EJECUCION', 'PENDIENTE_REPUESTOS', 'PENDIENTE_PROVEEDOR', 'PENDIENTE_VALIDACION', 'CERRADA', 'CANCELADA']);
const ListQ = z.object({
  ...zPage,
  type: z.enum(['PREVENTIVA', 'CORRECTIVA']).optional(),
  status: WSTATUS.optional(),
  priority: PRIORITY.optional(),
  assetId: z.string().uuid().optional(),
  areaId: z.string().uuid().optional(),
  assignedToId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  mine: zBoolQ,
  active: zBoolQ,
});
const CreateWO = z.object({
  type: z.enum(['PREVENTIVA', 'CORRECTIVA']),
  assetId: z.string().uuid('Seleccione el activo'),
  title: zText(3, 200),
  description: zOptText(4000),
  priority: PRIORITY.default('MEDIA'),
  assignedToId: zOptUuid,
  supplierId: zOptUuid,
  scheduledDate: zOptYmd,
  dueDate: zOptYmd,
  failureReportId: zOptUuid,
  interventionType: zOptText(100),
});
const FromActivity = z.object({ assignedToId: zOptUuid });
const Assign = z.object({ assignedToId: z.string().uuid('Seleccione el responsable'), supplierId: zOptUuid.optional(), note: zOptText(1000) });
const Start = z.object({ startedAt: z.string().datetime({ offset: true }).optional().nullable() });
const Pause = z.object({ status: z.enum(['PENDIENTE_REPUESTOS', 'PENDIENTE_PROVEEDOR']), reason: zReason });
const Note = z.object({ note: zOptText(2000) });
const RejectNote = z.object({ note: zReason });
const Exec = z.object({
  interventionType: zOptText(100),
  activitiesPerformed: zOptText(10000),
  diagnosis: zOptText(10000),
  checklistResults: z.array(z.object({
    itemId: z.string().min(1).max(40), text: z.string().max(300).default(''), required: z.boolean().default(true),
    result: z.enum(['CUMPLE', 'NO_CUMPLE', 'NO_APLICA']).nullable(), note: zOptText(500),
  })).optional(),
  findings: zOptText(10000),
  result: zOptText(4000),
  testsPerformed: zOptText(4000),
  finalCondition: z.enum(['OPERATIVO', 'OPERATIVO_CON_OBSERVACIONES', 'FUERA_DE_SERVICIO', 'REQUIERE_BAJA']).optional().nullable(),
  laborCost: zMoney.optional(),
  externalCost: zMoney.optional(),
  startedAt: z.string().datetime({ offset: true }).optional().nullable(),
  finishedAt: z.string().datetime({ offset: true }).optional().nullable(),
});
const Part = z.object({ name: zText(2, 200), partNumber: zOptText(80), quantity: z.coerce.number().positive().max(100000), unitCost: zMoney });
const Close = z.object({
  verificationNote: z.string().trim().min(10, 'Documente la verificación (mín. 10 caracteres)').max(4000),
  validatorSignature: z.string().trim().min(5, 'Identificación de quien valida (nombre, cargo, documento)').max(300),
});
const Corrective = z.object({
  title: zText(3, 200),
  description: zText(10, 4000),
  safety: z.coerce.number().int().min(1).max(5),
  care: z.coerce.number().int().min(1).max(5),
  continuity: z.coerce.number().int().min(1).max(5),
  assetCondition: z.enum(['FUNCIONA_NORMAL', 'FUNCIONA_CON_LIMITACIONES', 'NO_FUNCIONA', 'RIESGO_SEGURIDAD']),
});

@ApiTags('Órdenes de trabajo')
@Controller('workorders')
export class WorkOrdersController {
  constructor(
    private readonly svc: WorkOrdersService,
    private readonly failures: FailuresService,
    private readonly reports: ReportsService,
  ) {}

  @Get()
  @AnyPerms('workorders.read', 'workorders.read_all')
  @ApiZQuery(ListQ)
  list(@Ctx() ctx: ReqCtx, @ZQuery(ListQ) q: z.infer<typeof ListQ>) {
    return this.svc.list(ctx, q);
  }

  @Get(':id')
  @AnyPerms('workorders.read', 'workorders.read_all')
  get(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ctx, id);
  }

  /** F-03 / F-04 / F-05: formato imprimible de la orden */
  @Get(':id/pdf')
  @AnyPerms('workorders.read', 'workorders.read_all')
  async pdf(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const wo = await this.svc.get(ctx, id);
    const buf = await this.reports.workOrderPdf(ctx, wo);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${wo.code}.pdf"`);
    res.send(buf);
  }

  @Post()
  @Perms('workorders.create')
  @ApiZBody(CreateWO)
  create(@Ctx() ctx: ReqCtx, @ZBody(CreateWO) b: z.infer<typeof CreateWO>) {
    return this.svc.create(ctx, b);
  }

  @Post('from-activity/:activityId')
  @Perms('workorders.create')
  @ApiZBody(FromActivity)
  fromActivity(@Ctx() ctx: ReqCtx, @Param('activityId', ParseUUIDPipe) activityId: string, @ZBody(FromActivity) b: z.infer<typeof FromActivity>) {
    return this.svc.createFromActivity(ctx, activityId, b.assignedToId);
  }

  @Post(':id/assign')
  @Perms('workorders.assign')
  @ApiZBody(Assign)
  assign(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(Assign) b: z.infer<typeof Assign>) {
    return this.svc.assign(ctx, id, b.assignedToId, b.supplierId, b.note);
  }

  @Post(':id/start')
  @Perms('workorders.execute')
  start(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(Start) b: z.infer<typeof Start>) {
    return this.svc.start(ctx, id, b.startedAt);
  }

  @Post(':id/pause')
  @Perms('workorders.execute')
  @ApiZBody(Pause)
  pause(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(Pause) b: z.infer<typeof Pause>) {
    return this.svc.pause(ctx, id, b.status, b.reason);
  }

  @Post(':id/resume')
  @Perms('workorders.execute')
  resume(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(Note) b: z.infer<typeof Note>) {
    return this.svc.resume(ctx, id, b.note);
  }

  @Patch(':id/execution')
  @Perms('workorders.execute')
  @ApiZBody(Exec)
  execution(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(Exec) b: z.infer<typeof Exec>) {
    return this.svc.saveExecution(ctx, id, b);
  }

  @Post(':id/parts')
  @Perms('workorders.execute')
  @ApiZBody(Part)
  addPart(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(Part) b: z.infer<typeof Part>) {
    return this.svc.addPart(ctx, id, b);
  }

  @Delete(':id/parts/:partId')
  @Perms('workorders.execute')
  removePart(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Param('partId', ParseUUIDPipe) partId: string, @ZBody(z.object({ reason: zReason })) b: { reason: string }) {
    return this.svc.removePart(ctx, id, partId, b.reason);
  }

  @Post(':id/submit')
  @Perms('workorders.execute')
  submit(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.submitForValidation(ctx, id);
  }

  @Post(':id/reject')
  @Perms('workorders.verify')
  @ApiZBody(RejectNote)
  reject(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(RejectNote) b: z.infer<typeof RejectNote>) {
    return this.svc.rejectValidation(ctx, id, b.note);
  }

  @Post(':id/close')
  @Perms('workorders.verify')
  @ApiZBody(Close)
  close(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(Close) b: z.infer<typeof Close>) {
    return this.svc.close(ctx, id, b);
  }

  @Post(':id/cancel')
  @Perms('workorders.cancel')
  @ApiZBody(z.object({ reason: zReason }))
  cancel(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(z.object({ reason: zReason })) b: { reason: string }) {
    return this.svc.cancel(ctx, id, b.reason);
  }

  /** Falla detectada durante la ejecución: genera reporte de falla + orden correctiva relacionada */
  @Post(':id/corrective')
  @Perms('workorders.execute', 'failures.report')
  @ApiZBody(Corrective)
  corrective(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(Corrective) b: z.infer<typeof Corrective>) {
    return this.failures.fromWorkOrderFinding(ctx, id, b);
  }
}
