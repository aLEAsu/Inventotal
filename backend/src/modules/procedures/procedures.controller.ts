import { Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService, diff } from '../../common/audit.service';
import type { ReqCtx } from '../../common/auth.types';
import { fmtYmd, parseYmd } from '../../common/dates';
import { Ctx, Perms } from '../../common/decorators';
import { PrismaService } from '../../common/prisma.service';
import { ApiZBody, zOptText, zText, zYmd, ZBody } from '../../common/zod';

const ProcUpdate = z.object({
  title: zText(3, 200).optional(),
  objective: zText(5, 2000).optional(),
  scope: zOptText(2000),
  responsible: zOptText(500),
  content: zText(10, 50000).optional(),
  isActive: z.boolean().optional(),
  pendingValidation: z.boolean().optional(),
  changeReason: z.string().trim().min(5).max(1000),
});
const FormatUpdate = z.object({
  name: zText(3, 200).optional(),
  documentCode: zText(1, 40).optional(),
  version: zText(1, 20).optional(),
  effectiveDate: zYmd.optional(),
  elaboratedBy: zOptText(200),
  reviewedBy: zOptText(200),
  approvedBy: zOptText(200),
  changeDescription: z.string().trim().min(5).max(1000),
});

@ApiTags('Procedimientos y formatos')
@Controller()
export class ProceduresController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('procedures')
  @Perms('procedures.read')
  list() {
    return this.prisma.procedure.findMany({ orderBy: { code: 'asc' } });
  }

  @Get('procedures/:id')
  @Perms('procedures.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.procedure.findUniqueOrThrow({ where: { id } });
  }

  @Patch('procedures/:id')
  @Perms('procedures.manage')
  @ApiZBody(ProcUpdate)
  async update(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(ProcUpdate) b: z.infer<typeof ProcUpdate>) {
    const before = await this.prisma.procedure.findUniqueOrThrow({ where: { id } });
    const { changeReason, ...data } = b;
    const after = await this.prisma.procedure.update({ where: { id }, data: { ...data, version: before.version + 1, updatedById: ctx.user.id } });
    await this.audit.log(ctx, { action: 'EDITAR', module: 'procedimientos', entity: 'Procedure', entityId: id, ...diff(before, after), reason: changeReason });
    return after;
  }

  @Get('formats')
  @Perms('procedures.read')
  async formats() {
    const rows = await this.prisma.documentFormat.findMany({ orderBy: { code: 'asc' } });
    return rows.map((r) => ({ ...r, effectiveDate: fmtYmd(r.effectiveDate) }));
  }

  @Patch('formats/:code')
  @Perms('procedures.manage')
  @ApiZBody(FormatUpdate)
  async updateFormat(@Ctx() ctx: ReqCtx, @Param('code') code: string, @ZBody(FormatUpdate) b: z.infer<typeof FormatUpdate>) {
    const before = await this.prisma.documentFormat.findUniqueOrThrow({ where: { code } });
    const { changeDescription, ...data } = b;
    const log = [...((before.changeLog as { version: string; date: string; description: string }[]) ?? [])];
    log.push({ version: b.version ?? before.version, date: b.effectiveDate ?? fmtYmd(new Date()), description: changeDescription });
    const after = await this.prisma.documentFormat.update({
      where: { code },
      data: { ...data, effectiveDate: b.effectiveDate ? parseYmd(b.effectiveDate) : undefined, changeLog: log },
    });
    await this.audit.log(ctx, { action: 'EDITAR', module: 'formatos', entity: 'DocumentFormat', entityId: code, ...diff(before, after), reason: changeDescription });
    return { ...after, effectiveDate: fmtYmd(after.effectiveDate) };
  }
}
