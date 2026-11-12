import { Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { ReqCtx } from '../../common/auth.types';
import { fmtDateTimeBogota, fmtDMY, MONTHS_ES } from '../../common/dates';
import { fmtCOP, toNum } from '../../common/money';
import { addExcelLogos } from '../../common/excel-brand';
import { InstitutionalPdf, PdfOptions } from '../../common/pdf';
import { PrismaService } from '../../common/prisma.service';
import { areaFilter } from '../../common/scope';
import { SettingsService } from '../../common/settings.service';
import type { Prisma } from '../../generated/prisma/client';
import { IndicatorFilters, IndicatorsService, Ratio } from '../dashboard/indicators.service';
import { FailuresService } from '../failures/failures.service';
import type { LifecycleService } from '../lifecycle/lifecycle.service';
import { PlansService } from '../plans/plans.service';
import type { ChecklistResult } from '../workorders/workorders.service';

const L: Record<string, string> = {
  OPERATIVO: 'Operativo', OPERATIVO_CON_OBSERVACIONES: 'Operativo con observaciones', EN_MANTENIMIENTO: 'En mantenimiento',
  FUERA_DE_SERVICIO: 'Fuera de servicio', RETIRADO: 'Retirado', DADO_DE_BAJA: 'Dado de baja', REQUIERE_BAJA: 'Requiere baja',
  CRITICA: 'Crítica', ALTA: 'Alta', MEDIA: 'Media', BAJA: 'Baja', URGENTE: 'Urgente',
  PREVENTIVA: 'Preventiva', CORRECTIVA: 'Correctiva', ABIERTA: 'Abierta', ASIGNADA: 'Asignada', EN_EJECUCION: 'En ejecución',
  PENDIENTE_REPUESTOS: 'Pendiente de repuestos', PENDIENTE_PROVEEDOR: 'Pendiente de proveedor', PENDIENTE_VALIDACION: 'Pendiente de validación',
  CERRADA: 'Cerrada', CANCELADA: 'Cancelada', REPORTADA: 'Reportada', EN_EVALUACION: 'En evaluación', EN_ATENCION: 'En atención',
  RESUELTA: 'Resuelta', ANULADA: 'Anulada', CUMPLE: 'Cumple', NO_CUMPLE: 'No cumple', NO_APLICA: 'No aplica',
  FUNCIONA_NORMAL: 'Funciona normalmente', FUNCIONA_CON_LIMITACIONES: 'Funciona con limitaciones', NO_FUNCIONA: 'No funciona', RIESGO_SEGURIDAD: 'Riesgo para la seguridad',
};
export const label = (v: string | null | undefined) => (v ? L[v] ?? v : '—');
const pct = (r: Ratio) => (r.insufficient || r.value === null ? `Sin datos suficientes${r.note ? ` (${r.note})` : ''}` : `${r.value.toFixed(1)} % (${r.numerator}/${r.denominator})`);
const hrs = (v: { value: number | null; n: number; insufficient: boolean }) => (v.insufficient || v.value === null ? 'Sin datos suficientes' : `${v.value} h (n=${v.n})`);

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly indicators: IndicatorsService,
    private readonly plans: PlansService,
    private readonly failures: FailuresService,
  ) {}

  async newPdf(ctx: ReqCtx, formatCode: string, subtitle?: string, opts?: PdfOptions) {
    const fmt = await this.prisma.documentFormat.findUnique({ where: { code: formatCode } });
    if (!fmt) throw new NotFoundException(`Formato ${formatCode} no configurado`);
    const [institution, nit, color] = await Promise.all([
      this.settings.get<string>('institution.name'),
      this.settings.get<string>('institution.nit'),
      this.settings.get<string>('institution.primaryColor'),
    ]);
    const pdf = new InstitutionalPdf(
      { institution, institutionNit: nit, title: fmt.name.toUpperCase(), subtitle, documentCode: fmt.documentCode, version: fmt.version, effectiveDate: fmtDMY(fmt.effectiveDate), primaryColor: color, generatedBy: ctx.user.fullName },
      opts,
    );
    return { pdf, fmt };
  }

  private formatSignatures(pdf: InstitutionalPdf, fmt: { elaboratedBy: string | null; reviewedBy: string | null; approvedBy: string | null }) {
    pdf.signatures([
      { role: 'Elaboró', name: fmt.elaboratedBy },
      { role: 'Revisó', name: fmt.reviewedBy },
      { role: 'Aprobó', name: fmt.approvedBy },
    ]);
  }

  // ---------------------------------------------------------- F-01 Inventario general
  async inventoryPdf(ctx: ReqCtx, f: { categoryId?: string; areaId?: string; status?: string }) {
    const assets = await this.prisma.asset.findMany({
      where: { ...areaFilter(ctx.user), ...(f.categoryId ? { categoryId: f.categoryId } : {}), ...(f.areaId ? { areaId: f.areaId } : {}), ...(f.status ? { status: f.status as never } : {}) },
      include: { category: true, area: true, location: true, responsible: { select: { fullName: true } } },
      orderBy: [{ category: { name: 'asc' } }, { code: 'asc' }],
    });
    const { pdf, fmt } = await this.newPdf(ctx, 'F-01', `Total de activos: ${assets.length} · Corte: ${fmtDateTimeBogota(new Date())}`, { orientation: 'landscape' });
    pdf.table({
      head: [['Código', 'Nombre', 'Categoría', 'Marca / Modelo', 'Serie', 'Hostname / IP', 'Ubicación', 'Área', 'Usuario final', 'Criticidad', 'Estado', 'Garantía']],
      body: assets.map((a) => [a.code, a.name, a.category.name, [a.brand, a.model].filter(Boolean).join(' / ') || '—', a.serialNumber ?? '—', [a.hostname, a.ipAddress].filter(Boolean).join(' / ') || '—', a.location?.name ?? '—', a.area.name, a.endUser ?? '—', label(a.criticality), label(a.status), a.warrantyUntil ? fmtDMY(a.warrantyUntil) : '—']),
      styles: { fontSize: 7 },
    });
    this.formatSignatures(pdf, fmt);
    return pdf.finalize();
  }

  async inventoryXlsx(ctx: ReqCtx) {
    const assets = await this.prisma.asset.findMany({
      where: areaFilter(ctx.user),
      include: { category: true, subcategory: true, area: true, location: true, responsible: { select: { fullName: true } }, supplier: { select: { name: true } } },
      orderBy: [{ code: 'asc' }],
    });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Inventario F-01');
    const institution = await this.settings.get<string>('institution.name');
    ws.addRow([institution]).font = { bold: true, size: 13 };
    ws.mergeCells(1, 1, 1, 10);
    addExcelLogos(wb, ws, 10);
    ws.addRow([`F-01 Inventario general de activos — ${fmtDateTimeBogota(new Date())}`]).font = { bold: true };
    ws.addRow([]);
    const h = ws.addRow(['Código', 'Nombre', 'Categoría', 'Subcategoría', 'Marca', 'Modelo', 'Serie', 'Ubicación', 'Área', 'Fabricante', 'Proveedor', 'Adquisición', 'Instalación', 'Garantía hasta', 'Costo (COP)', 'Criticidad', 'Estado', 'Responsable', 'Hostname', 'IP', 'MAC', 'Sistema operativo', 'Versión software', 'Procesador', 'RAM (GB)', 'Almacenamiento (GB)', 'Usuario final', 'Licencia vence']);
    h.font = { bold: true };
    for (const a of assets) {
      const r = ws.addRow([a.code, a.name, a.category.name, a.subcategory?.name ?? '', a.brand ?? '', a.model ?? '', a.serialNumber ?? '', a.location?.name ?? '', a.area.name, a.manufacturer ?? '', a.supplier?.name ?? '', a.acquisitionDate, a.installationDate, a.warrantyUntil, a.acquisitionCost ? toNum(a.acquisitionCost) : null, label(a.criticality), label(a.status), a.responsible?.fullName ?? '', a.hostname ?? '', a.ipAddress ?? '', a.macAddress ?? '', a.operatingSystem ?? '', a.softwareVersion ?? '', a.processor ?? '', a.ramGb ?? null, a.storageGb ?? null, a.endUser ?? '', a.licenseExpiresAt]);
      r.getCell(28).numFmt = 'dd/mm/yyyy';
      [12, 13, 14].forEach((i) => (r.getCell(i).numFmt = 'dd/mm/yyyy'));
      r.getCell(15).numFmt = '"$"#,##0';
    }
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 28 } };
    ws.columns.forEach((c) => (c.width = 16));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ---------------------------------------------------------- F-03/F-04/F-05 Orden de trabajo
  async workOrderPdf(ctx: ReqCtx, w: Awaited<ReturnType<import('../workorders/workorders.service').WorkOrdersService['get']>>) {
    const code = w.type === 'PREVENTIVA' ? 'F-04' : 'F-05';
    const { pdf, fmt } = await this.newPdf(ctx, code, `Orden ${w.code} · F-03 Orden de trabajo`);
    pdf.section('Datos de la orden (F-03)');
    pdf.keyValues([
      ['Número de orden', w.code], ['Tipo', label(w.type)], ['Estado', label(w.status)], ['Prioridad', label(w.priority)],
      ['Activo', `${w.asset.code} — ${w.asset.name}`], ['Área', w.area.name], ['Ubicación', w.asset.location?.name ?? '—'], ['Criticidad', label(w.asset.criticality)],
      ['Fecha programada', w.scheduledDate ? fmtDMY(w.scheduledDate) : '—'], ['Fecha original aprobada', w.activity ? fmtDMY(w.activity.originalDate) : '—'],
      ['Inicio', fmtDateTimeBogota(w.startedAt)], ['Finalización', fmtDateTimeBogota(w.finishedAt)],
      ['Técnico ejecutor', w.assignedTo?.fullName ?? '—'], ['Proveedor', w.supplier?.name ?? '—'],
      ['Tipo de intervención', w.interventionType ?? '—'], ['Reporte de falla', w.failureReport?.code ?? '—'],
    ]);
    pdf.section('Descripción');
    pdf.paragraph(`${w.title}\n${w.description ?? ''}`);
    if (w.activity?.program?.procedure) {
      pdf.section('Procedimiento técnico');
      pdf.paragraph(w.activity.program.procedure);
    }
    if (w.type === 'CORRECTIVA') {
      pdf.section('Diagnóstico técnico');
      pdf.paragraph(w.diagnosis ?? '—');
    }
    pdf.section('Actividades ejecutadas');
    pdf.paragraph(w.activitiesPerformed ?? '—');
    const cl = (w.checklistResults as unknown as ChecklistResult[] | null) ?? [];
    if (cl.length) {
      pdf.section('Lista de chequeo');
      pdf.table({ head: [['#', 'Ítem', 'Obligatorio', 'Resultado', 'Observación']], body: cl.map((c, i) => [i + 1, c.text, c.required ? 'Sí' : 'No', label(c.result), c.note ?? '']), columnStyles: { 0: { cellWidth: 8 } } });
    }
    pdf.section('Hallazgos y resultados');
    pdf.keyValues([['Hallazgos', w.findings ?? '—'], ['Resultado', w.result ?? '—'], ['Pruebas realizadas', w.testsPerformed ?? '—'], ['Condición final', label(w.finalCondition)]], 1);
    pdf.section('Repuestos y costos (COP)');
    pdf.table({
      head: [['Repuesto', 'Referencia', 'Cantidad', 'Valor unitario', 'Total']],
      body: w.parts.length ? w.parts.map((p) => [p.name, p.partNumber ?? '—', toNum(p.quantity), fmtCOP(p.unitCost), fmtCOP(p.totalCost)]) : [['Sin repuestos registrados', '', '', '', '']],
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    });
    pdf.keyValues([['Mano de obra', fmtCOP(w.laborCost)], ['Servicios externos', fmtCOP(w.externalCost)], ['Repuestos', fmtCOP(w.partsCost)], ['COSTO TOTAL', fmtCOP(w.totalCost)]]);
    pdf.section('Evidencias adjuntas');
    pdf.table({ head: [['Tipo', 'Título', 'Archivo', 'Fecha']], body: w.documents.length ? w.documents.map((d) => [d.type, d.title, d.originalName, fmtDateTimeBogota(d.uploadedAt)]) : [['—', 'Sin evidencias', '', '']] });
    pdf.section('Validación técnica');
    pdf.keyValues([['Verificó', w.verifiedBy?.fullName ?? 'Pendiente'], ['Fecha de verificación', fmtDateTimeBogota(w.verifiedAt)], ['Identificación de quien valida', w.validatorSignature ?? '—'], ['Observación', w.verificationNote ?? '—']], 1);
    pdf.section('Historial de la orden');
    pdf.table({ head: [['Fecha', 'Acción', 'De', 'A', 'Usuario', 'Nota']], body: w.events.map((e) => [fmtDateTimeBogota(e.createdAt), e.action, label(e.fromStatus), label(e.toStatus), e.user ?? '', e.note ?? '']), styles: { fontSize: 7 } });
    pdf.signatures([{ role: 'Ejecutó', name: w.assignedTo?.fullName }, { role: 'Verificó', name: w.verifiedBy?.fullName, detail: w.validatorSignature }, { role: 'Recibe a satisfacción (área)', name: null }]);
    void fmt;
    return pdf.finalize();
  }

  // ---------------------------------------------------------- F-06 Hoja de vida
  async lifecyclePdf(ctx: ReqCtx, d: Awaited<ReturnType<LifecycleService['get']>>) {
    const a = d.asset;
    const { pdf, fmt } = await this.newPdf(ctx, 'F-06', `${a.code} — ${a.name}`);
    pdf.section('Información general e identificación');
    pdf.keyValues([
      ['Código', a.code], ['Nombre', a.name], ['Categoría', a.category.name], ['Subcategoría', a.subcategory?.name ?? '—'],
      ['Marca', a.brand ?? '—'], ['Modelo', a.model ?? '—'], ['Serie', a.serialNumber ?? '—'], ['Fabricante', a.manufacturer ?? '—'],
      ['Ubicación', a.location?.name ?? '—'], ['Área responsable', a.area.name], ['Responsable', a.responsible?.fullName ?? '—'], ['Proveedor', a.supplier?.name ?? '—'],
      ['Adquisición', fmtDMY(a.acquisitionDate)], ['Instalación', fmtDMY(a.installationDate)], ['Garantía hasta', fmtDMY(a.warrantyUntil) || '—'], ['Costo de adquisición', a.acquisitionCost ? fmtCOP(a.acquisitionCost) : '—'],
      ['Hostname', a.hostname ?? '—'], ['Dirección IP', a.ipAddress ?? '—'], ['MAC', a.macAddress ?? '—'], ['Sistema operativo', a.operatingSystem ?? '—'],
      ['Procesador', a.processor ?? '—'], ['RAM / Almacenamiento', `${a.ramGb ?? '—'} GB / ${a.storageGb ?? '—'} GB`], ['Versión de software', a.softwareVersion ?? '—'], ['Licencia vence', fmtDMY(a.licenseExpiresAt) || '—'],
      ['Usuario final', a.endUser ?? '—'], ['', ''],
      ['Criticidad', label(a.criticality)], ['Estado', label(a.status)], ['Último mantenimiento', fmtDMY(d.stats.lastMaintenanceDate) || '—'], ['Próximo mantenimiento', fmtDMY(d.stats.nextMaintenanceDate) || '—'],
      ['Registrado por', a.createdBy.fullName], ['Fecha de registro', fmtDateTimeBogota(a.createdAt)],
    ]);
    if (a.description || a.warrantyInfo || a.notes) pdf.keyValues([['Descripción', a.description ?? '—'], ['Garantía', a.warrantyInfo ?? '—'], ['Observaciones', a.notes ?? '—']], 1);
    pdf.section('Resumen');
    pdf.keyValues([
      ['Órdenes preventivas', d.stats.preventiveOrders], ['Órdenes correctivas', d.stats.correctiveOrders], ['Fallas reportadas', d.stats.failures], ['Indisponibilidad acumulada', `${d.stats.downtimeHours} h`],
      ['Costo total', fmtCOP(d.stats.costs.total)], ['Costo preventivo', fmtCOP(d.stats.costs.preventive)], ['Costo correctivo', fmtCOP(d.stats.costs.corrective)], ['Costo en repuestos', fmtCOP(d.stats.costs.parts)],
    ]);
    pdf.section('Evaluaciones de criticidad');
    pdf.table({ head: [['Fecha', 'Puntaje', 'Calculado', 'Asignado', 'Justificación', 'Evaluó']], body: d.criticality.length ? d.criticality.map((c) => [fmtDateTimeBogota(c.assessedAt), String(c.totalScore), label(c.computedLevel), label(c.assignedLevel), c.justification, c.assessedBy ?? '']) : [['—', '', '', '', 'Sin evaluaciones registradas', '']] });
    pdf.section('Programas preventivos');
    pdf.table({ head: [['Código', 'Mantenimiento', 'Periodicidad', 'Sustento de la periodicidad', 'Responsable', 'Activo']], body: d.programs.length ? d.programs.map((p) => [p.code, p.name, p.frequencyLabel, p.frequencyJustification, p.responsible?.fullName ?? '—', p.isActive ? 'Sí' : 'No']) : [['—', 'Sin programas', '', '', '', '']] });
    pdf.section('Cronograma histórico');
    pdf.table({ head: [['Año', 'Programa', 'Fecha original', 'Fecha comprometida', 'Ejecución', 'Estado', 'OT']], body: d.activities.length ? d.activities.map((x) => [x.year, `${x.programCode} ${x.programName}`, fmtDMY(x.originalDate), fmtDMY(x.committedDate), fmtDMY(x.executedDate), x.displayStatusLabel, x.workOrder?.code ?? '']) : [['—', 'Sin actividades', '', '', '', '', '']], styles: { fontSize: 7 } });
    pdf.section('Órdenes de trabajo e intervenciones');
    pdf.table({ head: [['Orden', 'Tipo', 'Estado', 'Título', 'Ejecutor', 'Cierre', 'Condición final', 'Costo']], body: d.workOrders.length ? d.workOrders.map((w) => [w.code, label(w.type), label(w.status), w.title, w.assignedTo?.fullName ?? '—', fmtDateTimeBogota(w.closedAt), label(w.finalCondition), fmtCOP(w.totalCost)]) : [['—', '', '', 'Sin órdenes', '', '', '', '']], styles: { fontSize: 7 } });
    pdf.section('Fallas y reparaciones');
    pdf.table({ head: [['Reporte', 'Fecha', 'Falla', 'Prioridad', 'Estado', 'Indisponibilidad', 'Resuelta con']], body: d.failures.length ? d.failures.map((f) => [f.code, fmtDateTimeBogota(f.reportedAt), f.title, label(f.priority), label(f.status), f.downtimeStart ? `${fmtDateTimeBogota(f.downtimeStart)} → ${fmtDateTimeBogota(f.downtimeEnd) || 'en curso'}` : '—', f.resolvedBy?.code ?? '—']) : [['—', '', 'Sin fallas', '', '', '', '']], styles: { fontSize: 7 } });
    pdf.section('Repuestos utilizados');
    pdf.table({ head: [['Orden', 'Repuesto', 'Referencia', 'Cantidad', 'Total']], body: d.parts.length ? d.parts.map((p) => [p.workOrderCode, p.name, p.partNumber ?? '—', toNum(p.quantity), fmtCOP(p.totalCost)]) : [['—', 'Sin repuestos', '', '', '']] });
    pdf.section('Contratos, manuales, certificados y fotografías');
    pdf.table({ head: [['Contrato', 'Proveedor', 'Inicio', 'Vencimiento', 'Estado']], body: d.contracts.length ? d.contracts.map((c) => [c.number, c.supplier.name, fmtDMY(c.startDate), fmtDMY(c.endDate), c.status]) : [['Sin contratos asociados', '', '', '', '']] });
    pdf.table({ head: [['Tipo documental', 'Título', 'Archivo', 'Cargado', 'Por']], body: d.documents.length ? d.documents.map((x) => [x.type, x.title, x.originalName, fmtDateTimeBogota(x.uploadedAt), x.uploadedBy ?? '']) : [['Sin documentos', '', '', '', '']] });
    pdf.section('Historial de estados');
    pdf.table({ head: [['Fecha', 'De', 'A', 'Motivo', 'Usuario']], body: d.statusHistory.length ? d.statusHistory.map((h) => [fmtDateTimeBogota(h.createdAt), label(h.fromStatus), label(h.toStatus), h.reason ?? '', h.user ?? '']) : [['—', '', '', 'Sin cambios de estado', '']] });
    this.formatSignatures(pdf, fmt);
    return pdf.finalize();
  }

  // ---------------------------------------------------------- F-07 Solicitud de mantenimiento
  async failurePdf(ctx: ReqCtx, f: Awaited<ReturnType<FailuresService['get']>>) {
    const { pdf, fmt } = await this.newPdf(ctx, 'F-07', `Solicitud ${f.code}`);
    pdf.section('Datos de la solicitud');
    pdf.keyValues([
      ['Consecutivo', f.code], ['Fecha y hora del reporte', fmtDateTimeBogota(f.reportedAt)], ['Reportante', f.reporter.fullName], ['Área', f.area.name],
      ['Activo afectado', `${f.asset.code} — ${f.asset.name}`], ['Ubicación', f.asset.location?.name ?? '—'], ['Condición del activo', label(f.assetCondition)], ['Fuera de servicio', f.outOfService ? 'Sí' : 'No'],
      ['Prioridad', `${label(f.priority)} (puntaje ${f.priorityScore})`], ['Estado', label(f.status)], ['Asignado a', f.assignedTo?.fullName ?? '—'], ['Falla recurrente', f.recurring ? 'Sí' : 'No'],
    ]);
    pdf.section('Descripción de la falla');
    pdf.paragraph(`${f.title}\n${f.description}`);
    pdf.keyValues([['Impacto sobre el servicio', f.serviceImpact ?? '—'], ['Justificación de prioridad', f.priorityOverrideReason ?? 'Calculada por criterios configurados'], ['Observaciones', f.observations ?? '—']], 1);
    pdf.section('Atención');
    pdf.keyValues([
      ['Primera respuesta', fmtDateTimeBogota(f.firstResponseAt) || '—'], ['Resuelta', fmtDateTimeBogota(f.resolvedAt) || '—'],
      ['Inicio indisponibilidad', fmtDateTimeBogota(f.downtimeStart) || '—'], ['Restablecimiento', fmtDateTimeBogota(f.downtimeEnd) || '—'],
      ['Liberación autorizada por', f.releasedBy?.fullName ?? '—'], ['Fecha de liberación', fmtDateTimeBogota(f.releaseAuthorizedAt) || '—'],
      ['Órdenes de trabajo', f.workOrders.map((w) => `${w.code} (${label(w.status)})`).join(', ') || '—'], ['Resuelta con', f.resolvedBy?.code ?? '—'],
    ]);
    pdf.signatures([{ role: 'Reportó', name: f.reporter.fullName }, { role: 'Recibió (mantenimiento)', name: f.assignedTo?.fullName }, { role: 'Liberó', name: f.releasedBy?.fullName }]);
    void fmt;
    return pdf.finalize();
  }

  // ---------------------------------------------------------- F-08 Registro de inspección técnica
  async inspectionPdf(ctx: ReqCtx, activityId: string) {
    const a = await this.prisma.scheduledActivity.findUniqueOrThrow({ where: { id: activityId }, include: { asset: { include: { area: true, location: true } }, program: true, responsible: { select: { fullName: true } } } });
    const { pdf, fmt } = await this.newPdf(ctx, 'F-08', `${a.asset.code} — ${a.program.name}`);
    pdf.keyValues([
      ['Activo', `${a.asset.code} — ${a.asset.name}`], ['Área / Ubicación', `${a.asset.area.name} / ${a.asset.location?.name ?? '—'}`],
      ['Programa', `${a.program.code} — ${a.program.name}`], ['Fecha programada', fmtDMY(a.committedDate)],
      ['Responsable', a.responsible?.fullName ?? '—'], ['Duración estimada', a.program.estimatedDurationMin ? `${a.program.estimatedDurationMin} min` : '—'],
    ]);
    pdf.section('Procedimiento / requisitos técnicos');
    pdf.paragraph(`${a.program.procedure ?? '—'}\n\nRequisitos: ${a.program.technicalRequirements ?? '—'}`);
    pdf.section('Lista de verificación');
    const items = (a.program.checklist as { id: string; text: string; required: boolean }[]) ?? [];
    pdf.table({
      head: [['#', 'Ítem de verificación', 'Cumple', 'No cumple', 'N/A', 'Observaciones']],
      body: (items.length ? items : [{ id: '-', text: 'Sin lista de verificación configurada', required: false }]).map((i, n) => [n + 1, `${i.text}${i.required ? ' *' : ''}`, '', '', '', '']),
      columnStyles: { 0: { cellWidth: 8 }, 2: { cellWidth: 15 }, 3: { cellWidth: 17 }, 4: { cellWidth: 12 }, 5: { cellWidth: 50 } },
      bodyStyles: { minCellHeight: 8 },
    });
    pdf.paragraph('* Ítem obligatorio. Fecha y hora de inspección: ____/____/________  ____:____    Resultado general: ☐ Conforme   ☐ No conforme', 8);
    pdf.signatures([{ role: 'Inspeccionó' }, { role: 'Verificó' }]);
    void fmt;
    return pdf.finalize();
  }

  // ---------------------------------------------------------- F-09 Informe mensual / F-10 Cumplimiento anual
  async monthlyPdf(ctx: ReqCtx, f: IndicatorFilters & { year: number; month: number }) {
    const ind = await this.indicators.compute(ctx, f);
    const { pdf, fmt } = await this.newPdf(ctx, 'F-09', `${MONTHS_ES[f.month - 1]} de ${f.year}`);
    this.indicatorsBody(pdf, ind);
    this.formatSignatures(pdf, fmt);
    return pdf.finalize();
  }

  async compliancePdf(ctx: ReqCtx, f: IndicatorFilters & { year: number }) {
    const ind = await this.indicators.compute(ctx, { ...f, month: undefined });
    const plan = await this.plans.getPlan(f.year);
    const { pdf, fmt } = await this.newPdf(ctx, 'F-10', `Plan anual ${f.year} · ${plan ? `versión ${plan.version} (${plan.status})` : 'sin plan registrado'}`);
    this.indicatorsBody(pdf, ind);
    pdf.section('Cumplimiento por mes');
    pdf.table({ head: [['Mes', 'Programadas', 'Ejecutadas', '% (sobre programadas del mes)']], body: ind.charts.byMonth.map((m) => [MONTHS_ES[m.month - 1], m.programmed, m.executed, m.programmed ? `${((m.executed / m.programmed) * 100).toFixed(1)} %` : '—']) });
    if (plan) {
      const hist = await this.plans.history(f.year);
      pdf.section('Reprogramaciones (trazabilidad)');
      pdf.table({
        head: [['Solicitada', 'Actividad', 'Fecha original', 'De', 'A', 'Estado', 'Justificación', 'Solicitó', 'Decidió']],
        body: hist.reschedules.length ? hist.reschedules.map((r) => { const s = r.activity.programSnapshot as Record<string, string>; return [fmtDateTimeBogota(r.requestedAt), `${s.assetCode} ${s.programName}`, fmtDMY(r.activity.originalDate), fmtDMY(r.fromDate), fmtDMY(r.toDate), r.status, r.reason, r.requestedBy ?? '', r.decidedBy ?? '']; }) : [['—', 'Sin reprogramaciones', '', '', '', '', '', '', '']],
        styles: { fontSize: 6.8 },
      });
    }
    this.formatSignatures(pdf, fmt);
    return pdf.finalize();
  }

  private indicatorsBody(pdf: InstitutionalPdf, ind: Awaited<ReturnType<IndicatorsService['compute']>>) {
    const g = ind.general;
    const t = ind.times;
    pdf.section('Periodo');
    pdf.keyValues([['Desde', fmtDMY(ind.period.start)], ['Hasta', fmtDMY(ind.period.end)], ['Fecha de corte', fmtDMY(ind.period.cutoff)], ['Generado', fmtDateTimeBogota(new Date())]]);
    pdf.section('Indicadores generales');
    pdf.keyValues([
      ['Total de activos', g.totalAssets], ['Activos operativos', g.operativeAssets], ['Activos fuera de servicio', g.outOfServiceAssets], ['% fuera de servicio', pct(g.outOfServicePct)],
      ['Mantenimientos programados', g.programmed], ['Mantenimientos ejecutados', g.executed], ['Pendientes', g.pending], ['Vencidos', g.overdue],
      ['Correctivos abiertos', g.openCorrective], ['Correctivos urgentes', g.urgentCorrective], ['Costo de mantenimiento', fmtCOP(g.maintenanceCost)], ['', ''],
    ]);
    pdf.section('Cumplimiento preventivo');
    pdf.keyValues([
      ['Programa base aprobado', pct(g.complianceBase)], ['Fechas reprogramadas aprobadas', pct(g.complianceRescheduled)],
      ['Excluidas (canceladas / no aplica) — base', g.complianceBase.excluded], ['Excluidas — reprogramado', g.complianceRescheduled.excluded],
    ]);
    pdf.paragraph('Fórmula: actividades preventivas ejecutadas a tiempo (a más tardar el último día del mes de su fecha de referencia) / actividades exigibles con fecha de referencia entre el inicio del periodo y la fecha de corte × 100. Base: fecha originalmente aprobada. Reprogramado: fecha comprometida vigente.', 7);
    pdf.section('Tiempos y confiabilidad');
    pdf.keyValues([
      ['Tiempo medio de respuesta a fallas', hrs(t.meanResponseHours)], ['Tiempo medio de reparación', hrs(t.meanRepairHours)],
      ['Tiempo medio de solución', hrs(t.meanResolutionHours)], ['Indisponibilidad acumulada', t.downtimeHours.insufficient ? `Sin datos suficientes${t.downtimeHours.ongoing ? ` (${t.downtimeHours.ongoing} en curso)` : ''}` : `${t.downtimeHours.value} h (n=${t.downtimeHours.n}; ${t.downtimeHours.ongoing} en curso)`],
      ['Tasa de reincidencia', pct(t.recurrenceRate)], ['', ''],
    ]);
    pdf.section('Cumplimiento por área');
    pdf.table({ head: [['Área', 'Base aprobada', 'Reprogramado']], body: ind.charts.complianceByArea.length ? ind.charts.complianceByArea.map((a) => [a.area, pct(a.base), pct(a.rescheduled)]) : [['Sin datos', '', '']] });
    pdf.section('Mantenimiento por categoría y costos');
    const cats = Object.entries(ind.charts.byCategory);
    pdf.table({ head: [['Categoría', 'Programadas', 'Ejecutadas', 'Vencidas', 'Fallas', 'Costo (COP)']], body: cats.length ? cats.map(([c, v]) => [c, v.programmed, v.executed, v.overdue, ind.charts.failuresByCategory[c] ?? 0, fmtCOP(ind.charts.costByCategory[c] ?? 0)]) : [['Sin datos', '', '', '', '', '']] });
    pdf.section('Cumplimiento por proveedor');
    pdf.table({ head: [['Proveedor', 'Reprogramado', 'Base']], body: ind.charts.complianceBySupplier.length ? ind.charts.complianceBySupplier.map((s) => [s.supplier, pct(s.rescheduled), pct(s.base)]) : [['Sin actividades a cargo de proveedores', '', '']] });
    pdf.section('Activos con mayor número de fallas');
    pdf.table({ head: [['Código', 'Activo', 'Fallas']], body: ind.charts.topFailureAssets.length ? ind.charts.topFailureAssets.map((a) => [a.code, a.name, a.count]) : [['—', 'Sin fallas en el periodo', '']] });
  }

  // ---------------------------------------------------------- F-11 Evaluación de proveedores
  async supplierEvaluationPdf(ctx: ReqCtx, supplierId: string) {
    const s = await this.prisma.supplier.findUniqueOrThrow({ where: { id: supplierId }, include: { evaluations: { orderBy: { periodEnd: 'desc' } }, contracts: true } });
    const { pdf, fmt } = await this.newPdf(ctx, 'F-11', s.name);
    pdf.keyValues([['Proveedor', s.name], ['NIT', s.nit ?? '—'], ['Tipo', s.type], ['Especialidad', s.specialty ?? '—'], ['Contacto', s.contactName ?? '—'], ['Correo / Teléfono', [s.email, s.phone].filter(Boolean).join(' / ') || '—']]);
    pdf.section('Evaluaciones (escala 1 a 5)');
    pdf.table({
      head: [['Periodo', 'Oportunidad', 'Calidad', 'Documentación', 'Cumplimiento contractual', 'Atención', 'Promedio', 'Observaciones']],
      body: s.evaluations.length ? s.evaluations.map((e) => { const sc = e.scores as Record<string, number>; return [`${fmtDMY(e.periodStart)} - ${fmtDMY(e.periodEnd)}`, sc.oportunidad, sc.calidad, sc.documentacion, sc.cumplimientoContractual, sc.atencion, String(e.totalScore), e.observations ?? '']; }) : [['Sin evaluaciones registradas', '', '', '', '', '', '', '']],
    });
    this.formatSignatures(pdf, fmt);
    return pdf.finalize();
  }

  // ---------------------------------------------------------- F-12 Fallas recurrentes
  async recurringPdf(ctx: ReqCtx) {
    const r = await this.failures.recurring(ctx);
    const { pdf, fmt } = await this.newPdf(ctx, 'F-12', `Criterio: ${r.rule.count} o más fallas en ${r.rule.days} días`);
    pdf.table({
      head: [['Activo', 'Área', 'Categoría', 'N.º fallas', 'Reportes']],
      body: r.items.length ? r.items.map((i) => [`${i.asset?.code} ${i.asset?.name}`, i.asset?.area.name ?? '', i.asset?.category.name ?? '', i.count, i.failures.map((f) => `${f.code} (${fmtDMY(f.reportedAt.toISOString().slice(0, 10))}) ${f.title}`).join('\n')]) : [['Sin activos con fallas recurrentes según el criterio', '', '', '', '']],
    });
    pdf.paragraph('Análisis de causa y acciones propuestas (diligenciar): ____________________________________________________________', 8);
    this.formatSignatures(pdf, fmt);
    return pdf.finalize();
  }

  /** Criterio de alcance reutilizable */
  assetScope(ctx: ReqCtx): Prisma.AssetWhereInput {
    return areaFilter(ctx.user);
  }
}
