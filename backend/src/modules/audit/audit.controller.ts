import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import type { ReqCtx } from '../../common/auth.types';
import { fmtDateTimeBogota } from '../../common/dates';
import { Ctx, Perms } from '../../common/decorators';
import { PrismaService } from '../../common/prisma.service';
import { ApiZQuery, zPage, ZQuery } from '../../common/zod';
import type { Prisma } from '../../generated/prisma/client';

const Q = z.object({
  ...zPage,
  module: z.string().max(50).optional(),
  action: z.string().max(50).optional(),
  userId: z.string().uuid().optional(),
  entity: z.string().max(50).optional(),
  entityId: z.string().max(80).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** Bitácora de auditoría: solo lectura (la BD bloquea UPDATE/DELETE mediante triggers). */
@ApiTags('Auditoría')
@Controller()
export class AuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private where(q: z.infer<typeof Q>): Prisma.AuditLogWhereInput {
    return {
      ...(q.module ? { module: q.module } : {}),
      ...(q.action ? { action: q.action } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.entity ? { entity: q.entity } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.from || q.to ? { createdAt: { gte: q.from ? new Date(`${q.from}T00:00:00-05:00`) : undefined, lte: q.to ? new Date(`${q.to}T23:59:59.999-05:00`) : undefined } } : {}),
      ...(q.q ? { OR: [{ username: { contains: q.q, mode: 'insensitive' } }, { reason: { contains: q.q, mode: 'insensitive' } }, { entityId: { contains: q.q } }] } : {}),
    };
  }

  @Get('audit')
  @Perms('audit.read')
  @ApiZQuery(Q)
  async list(@ZQuery(Q) q: z.infer<typeof Q>) {
    const where = this.where(q);
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items: items.map((i) => ({ ...i, id: i.id.toString() })), total };
  }

  @Get('audit/facets')
  @Perms('audit.read')
  async facets() {
    const [modules, actions] = await Promise.all([
      this.prisma.auditLog.findMany({ distinct: ['module'], select: { module: true }, orderBy: { module: 'asc' } }),
      this.prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
    ]);
    return { modules: modules.map((m) => m.module), actions: actions.map((a) => a.action) };
  }

  @Get('audit/export.xlsx')
  @Perms('audit.read')
  async export(@Ctx() ctx: ReqCtx, @ZQuery(Q) q: z.infer<typeof Q>, @Res() res: Response) {
    const rows = await this.prisma.auditLog.findMany({ where: this.where(q), orderBy: { id: 'desc' }, take: 50_000 });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Auditoría');
    ws.addRow(['ID', 'Fecha y hora (Bogotá)', 'Usuario', 'Módulo', 'Operación', 'Entidad', 'Registro', 'Justificación', 'IP', 'Valores anteriores', 'Valores nuevos']).font = { bold: true };
    for (const r of rows) {
      ws.addRow([r.id.toString(), fmtDateTimeBogota(r.createdAt), r.username ?? '', r.module, r.action, r.entity ?? '', r.entityId ?? '', r.reason ?? '', r.ip ?? '', r.before ? JSON.stringify(r.before).slice(0, 30000) : '', r.after ? JSON.stringify(r.after).slice(0, 30000) : '']);
    }
    ws.autoFilter = { from: 'A1', to: 'K1' };
    ws.columns.forEach((c, i) => (c.width = [8, 18, 16, 14, 24, 18, 38, 40, 14, 50, 50][i]));
    await this.audit.log(ctx, { action: 'EXPORTAR', module: 'auditoria', after: { filtros: q, registros: rows.length } });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Bitacora_Auditoria.xlsx"');
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  }

  @Get('backups')
  @Perms('backups.read')
  async backups() {
    const rows = await this.prisma.backupRun.findMany({ orderBy: { startedAt: 'desc' }, take: 200 });
    return rows.map((r) => ({ ...r, id: r.id.toString(), sizeBytes: r.sizeBytes?.toString() ?? null }));
  }
}
