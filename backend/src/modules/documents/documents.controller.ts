import { BadRequestException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import type { ReqCtx } from '../../common/auth.types';
import { Ctx, Perms } from '../../common/decorators';
import { PrismaService } from '../../common/prisma.service';
import { areaFilter, assertAreaAccess, can } from '../../common/scope';
import { SettingsService } from '../../common/settings.service';
import { StorageService } from '../../common/storage.service';
import { ApiZQuery, zPage, zReason, ZBody, ZQuery } from '../../common/zod';
import type { Prisma } from '../../generated/prisma/client';

const DTYPE = z.enum(['MANUAL_TECNICO', 'FICHA_TECNICA', 'CERTIFICADO', 'INFORME_MANTENIMIENTO', 'FOTOGRAFIA', 'ACTA_SERVICIO', 'COTIZACION', 'FACTURA', 'GARANTIA', 'CONTRATO', 'OTRO']);
const optId = z.string().uuid().optional().or(z.literal('').transform(() => undefined));
const UploadMeta = z.object({
  type: DTYPE,
  title: z.string().trim().min(2, 'Ingrese el título').max(200),
  description: z.string().trim().max(1000).optional(),
  assetId: optId, workOrderId: optId, failureReportId: optId, supplierId: optId, contractId: optId, planId: optId,
});
const ListQ = z.object({
  ...zPage,
  type: DTYPE.optional(),
  assetId: z.string().uuid().optional(), workOrderId: z.string().uuid().optional(), failureReportId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(), contractId: z.string().uuid().optional(), planId: z.string().uuid().optional(),
  includeVoided: z.enum(['true', 'false']).optional(),
});

const MAX_HARD_LIMIT = 50 * 1024 * 1024;

@ApiTags('Documentos y evidencias')
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  @Perms('documents.read')
  @ApiZQuery(ListQ)
  async list(@Ctx() ctx: ReqCtx, @ZQuery(ListQ) q: z.infer<typeof ListQ>) {
    const scope: Prisma.DocumentWhereInput = ctx.user.scope === 'AREA'
      ? { OR: [{ asset: areaFilter(ctx.user) }, { workOrder: areaFilter(ctx.user) }, { failureReport: areaFilter(ctx.user) }] }
      : ctx.user.scope === 'OWN'
        ? { failureReport: { reporterId: ctx.user.id } }
        : {};
    const where: Prisma.DocumentWhereInput = {
      AND: [
        scope,
        q.includeVoided === 'true' ? {} : { voidedAt: null },
        q.type ? { type: q.type } : {},
        ...(['assetId', 'workOrderId', 'failureReportId', 'supplierId', 'contractId', 'planId'] as const).filter((k) => q[k]).map((k) => ({ [k]: q[k] })),
        q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { originalName: { contains: q.q, mode: 'insensitive' } }] } : {},
      ],
    };
    const [items, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        include: {
          asset: { select: { id: true, code: true, name: true } }, workOrder: { select: { id: true, code: true } },
          failureReport: { select: { id: true, code: true } }, supplier: { select: { id: true, name: true } },
          contract: { select: { id: true, number: true } }, plan: { select: { id: true, year: true } },
        },
        orderBy: { uploadedAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.document.count({ where }),
    ]);
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(items.map((i) => i.uploadedById))] } }, select: { id: true, fullName: true } });
    const um = new Map(users.map((u) => [u.id, u.fullName]));
    return { items: items.map((d) => ({ ...d, storedName: undefined, uploadedBy: um.get(d.uploadedById) ?? null })), total };
  }

  @Post()
  @Perms('documents.upload')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_HARD_LIMIT, files: 1 } }))
  async upload(@Ctx() ctx: ReqCtx, @UploadedFile() file: Express.Multer.File | undefined, @ZBody(UploadMeta) meta: z.infer<typeof UploadMeta>) {
    if (!file) throw new BadRequestException('Adjunte un archivo');
    const links = (['assetId', 'workOrderId', 'failureReportId', 'supplierId', 'contractId', 'planId'] as const).filter((k) => meta[k]);
    if (!links.length) throw new BadRequestException('El documento debe asociarse a un activo, orden, falla, proveedor, contrato o plan');
    await this.assertLinkAccess(ctx, meta, true);
    const allowed = await this.settings.get<string[]>('documents.allowedTypes');
    const maxMb = await this.settings.get<number>('documents.maxSizeMb');
    const envMax = Number(process.env.MAX_UPLOAD_MB ?? maxMb);
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8').replace(/[\\/\0]/g, '_').slice(0, 200);
    const saved = await this.storage.save(file.buffer, name, file.mimetype, allowed, Math.min(maxMb, envMax) * 1048576);
    const doc = await this.prisma.document.create({
      data: {
        type: meta.type, title: meta.title, description: meta.description ?? null, originalName: name, ...saved,
        assetId: meta.assetId ?? null, workOrderId: meta.workOrderId ?? null, failureReportId: meta.failureReportId ?? null,
        supplierId: meta.supplierId ?? null, contractId: meta.contractId ?? null, planId: meta.planId ?? null, uploadedById: ctx.user.id,
      },
    });
    if (meta.workOrderId) {
      const wo = await this.prisma.workOrder.findUniqueOrThrow({ where: { id: meta.workOrderId } });
      await this.prisma.workOrderEvent.create({ data: { workOrderId: wo.id, userId: ctx.user.id, action: 'ADJUNTAR_EVIDENCIA', fromStatus: wo.status, toStatus: wo.status, note: `${meta.type}: ${meta.title}` } });
    }
    await this.audit.log(ctx, { action: 'ADJUNTAR', module: 'documentos', entity: 'Document', entityId: doc.id, after: { ...doc, storedName: undefined } });
    return { ...doc, storedName: undefined };
  }

  @Get(':id/download')
  @Perms('documents.read')
  async download(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const d = await this.prisma.document.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('Documento no encontrado');
    await this.assertLinkAccess(ctx, d, false);
    if (!(await this.storage.exists(d.storedName))) throw new NotFoundException('El archivo no se encuentra en el almacenamiento');
    res.setHeader('Content-Type', d.mimeType);
    res.setHeader('Content-Length', String(d.sizeBytes));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    const inline = d.mimeType.startsWith('image/') || d.mimeType === 'application/pdf';
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(d.originalName)}`);
    this.storage.stream(d.storedName).pipe(res);
  }

  /** Anulación lógica: el archivo y su registro se conservan para trazabilidad */
  @Post(':id/void')
  @Perms('documents.void')
  async void(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(z.object({ reason: zReason })) b: { reason: string }) {
    const d = await this.prisma.document.findUniqueOrThrow({ where: { id } });
    if (d.voidedAt) throw new BadRequestException('El documento ya está anulado');
    await this.assertLinkAccess(ctx, d, true);
    const r = await this.prisma.document.update({ where: { id }, data: { voidedAt: new Date(), voidedById: ctx.user.id, voidReason: b.reason } });
    await this.audit.log(ctx, { action: 'ANULAR', module: 'documentos', entity: 'Document', entityId: id, reason: b.reason });
    return { ...r, storedName: undefined };
  }

  private async assertLinkAccess(ctx: ReqCtx, d: { assetId?: string | null; workOrderId?: string | null; failureReportId?: string | null; supplierId?: string | null; contractId?: string | null; planId?: string | null }, write: boolean) {
    if (ctx.user.scope === 'OWN') {
      // Solicitantes: solo evidencias de sus propios reportes de falla
      if (d.assetId || d.workOrderId || d.supplierId || d.contractId || d.planId || !d.failureReportId) throw new ForbiddenException('Solo puede adjuntar o consultar soportes de sus propios reportes');
    }
    if (!write && (d.supplierId || d.contractId) && !can(ctx.user, 'suppliers.read')) throw new ForbiddenException('No tiene acceso a documentos de proveedores');
    if (d.assetId) {
      const a = await this.prisma.asset.findUnique({ where: { id: d.assetId } });
      if (!a) throw new BadRequestException('Activo inexistente');
      assertAreaAccess(ctx.user, a.areaId);
    }
    if (d.workOrderId) {
      const w = await this.prisma.workOrder.findUnique({ where: { id: d.workOrderId } });
      if (!w) throw new BadRequestException('Orden inexistente');
      if (can(ctx.user, 'workorders.read_all')) assertAreaAccess(ctx.user, w.areaId);
      else if (w.assignedToId !== ctx.user.id && w.createdById !== ctx.user.id) throw new ForbiddenException('No tiene acceso a la orden');
      if (write && ['CERRADA', 'CANCELADA'].includes(w.status) && !can(ctx.user, 'workorders.verify')) {
        throw new ForbiddenException('La orden está cerrada; solo la coordinación puede adjuntar soportes adicionales');
      }
    }
    if (d.failureReportId) {
      const f = await this.prisma.failureReport.findUnique({ where: { id: d.failureReportId } });
      if (!f) throw new BadRequestException('Reporte inexistente');
      if (can(ctx.user, 'failures.read_all')) assertAreaAccess(ctx.user, f.areaId);
      else if (f.reporterId !== ctx.user.id && f.assignedToId !== ctx.user.id) throw new ForbiddenException('No tiene acceso al reporte');
    }
  }
}
