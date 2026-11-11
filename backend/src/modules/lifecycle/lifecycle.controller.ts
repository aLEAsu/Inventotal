import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { ReqCtx } from '../../common/auth.types';
import { Ctx, Perms } from '../../common/decorators';
import { AuditService } from '../../common/audit.service';
import { ReportsService } from '../reports/reports.service';
import { LifecycleService } from './lifecycle.service';

@ApiTags('Hojas de vida')
@Controller('assets/:id/lifecycle')
export class LifecycleController {
  constructor(
    private readonly svc: LifecycleService,
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Perms('assets.read')
  get(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ctx, id);
  }

  /** F-06 Hoja de vida del activo (PDF completo) */
  @Get('pdf')
  @Perms('assets.read')
  async pdf(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const data = await this.svc.get(ctx, id);
    const buf = await this.reports.lifecyclePdf(ctx, data);
    await this.audit.log(ctx, { action: 'EXPORTAR_PDF', module: 'hojas_de_vida', entity: 'Asset', entityId: id });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Hoja_de_vida_${data.asset.code}.pdf"`);
    res.send(buf);
  }
}
