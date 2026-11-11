import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { ReqCtx } from '../../common/auth.types';
import { Ctx, Perms } from '../../common/decorators';
import { ApiZQuery, ZQuery } from '../../common/zod';
import { IndicatorsService } from './indicators.service';

export const IndicatorQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  areaId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  responsibleId: z.string().uuid().optional(),
});

@ApiTags('Dashboard e indicadores')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly svc: IndicatorsService) {}

  @Get()
  @Perms('dashboard.read')
  @ApiZQuery(IndicatorQuery)
  get(@Ctx() ctx: ReqCtx, @ZQuery(IndicatorQuery) q: z.infer<typeof IndicatorQuery>) {
    return this.svc.compute(ctx, q);
  }
}
