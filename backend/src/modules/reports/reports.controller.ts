import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import type { ReqCtx } from '../../common/auth.types';
import { currentYearBogota } from '../../common/dates';
import { AnyPerms, Ctx, Perms } from '../../common/decorators';
import { ApiZQuery, ZQuery } from '../../common/zod';
import { IndicatorQuery } from '../dashboard/dashboard.controller';
import { FailuresService } from '../failures/failures.service';
import { ReportsService } from './reports.service';

const InvQ = z.object({ categoryId: z.string().uuid().optional(), areaId: z.string().uuid().optional(), status: z.string().max(40).optional() });

@ApiTags('Informes y formatos')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly svc: ReportsService,
    private readonly failures: FailuresService,
    private readonly audit: AuditService,
  ) {}

  private async send(ctx: ReqCtx, res: Response, buf: Buffer, name: string, format: string, type = 'application/pdf') {
    await this.audit.log(ctx, { action: 'GENERAR_INFORME', module: 'informes', entity: 'DocumentFormat', entityId: format, after: { archivo: name, bytes: buf.length } });
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(buf);
  }

  @Get('inventory.pdf')
  @Perms('reports.read', 'assets.read')
  @ApiZQuery(InvQ)
  async inventory(@Ctx() ctx: ReqCtx, @ZQuery(InvQ) q: z.infer<typeof InvQ>, @Res() res: Response) {
    return this.send(ctx, res, await this.svc.inventoryPdf(ctx, q), 'F-01_Inventario_general.pdf', 'F-01');
  }

  @Get('inventory.xlsx')
  @Perms('reports.read', 'assets.read')
  async inventoryXlsx(@Ctx() ctx: ReqCtx, @Res() res: Response) {
    return this.send(ctx, res, await this.svc.inventoryXlsx(ctx), 'F-01_Inventario_general.xlsx', 'F-01', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  @Get('failures/:id.pdf')
  @AnyPerms('failures.read', 'failures.read_all')
  async failure(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const f = await this.failures.get(ctx, id);
    return this.send(ctx, res, await this.svc.failurePdf(ctx, f), `F-07_${f.code}.pdf`, 'F-07');
  }

  @Get('inspection/:activityId.pdf')
  @Perms('plans.read')
  async inspection(@Ctx() ctx: ReqCtx, @Param('activityId', ParseUUIDPipe) id: string, @Res() res: Response) {
    return this.send(ctx, res, await this.svc.inspectionPdf(ctx, id), 'F-08_Inspeccion_tecnica.pdf', 'F-08');
  }

  @Get('monthly.pdf')
  @Perms('reports.read')
  @ApiZQuery(IndicatorQuery)
  async monthly(@Ctx() ctx: ReqCtx, @ZQuery(IndicatorQuery) q: z.infer<typeof IndicatorQuery>, @Res() res: Response) {
    const year = q.year ?? currentYearBogota();
    const month = q.month ?? Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', month: '2-digit' }).format(new Date()));
    return this.send(ctx, res, await this.svc.monthlyPdf(ctx, { ...q, year, month }), `F-09_Informe_mensual_${year}-${String(month).padStart(2, '0')}.pdf`, 'F-09');
  }

  @Get('compliance.pdf')
  @Perms('reports.read')
  @ApiZQuery(IndicatorQuery)
  async compliance(@Ctx() ctx: ReqCtx, @ZQuery(IndicatorQuery) q: z.infer<typeof IndicatorQuery>, @Res() res: Response) {
    const year = q.year ?? currentYearBogota();
    return this.send(ctx, res, await this.svc.compliancePdf(ctx, { ...q, year }), `F-10_Cumplimiento_plan_${year}.pdf`, 'F-10');
  }

  @Get('suppliers/:id/evaluation.pdf')
  @Perms('reports.read', 'suppliers.read')
  async supplierEval(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    return this.send(ctx, res, await this.svc.supplierEvaluationPdf(ctx, id), 'F-11_Evaluacion_proveedor.pdf', 'F-11');
  }

  @Get('recurring-failures.pdf')
  @Perms('reports.read', 'failures.read_all')
  async recurring(@Ctx() ctx: ReqCtx, @Res() res: Response) {
    return this.send(ctx, res, await this.svc.recurringPdf(ctx), 'F-12_Fallas_recurrentes.pdf', 'F-12');
  }
}
