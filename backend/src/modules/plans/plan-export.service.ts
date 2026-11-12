import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { ReqCtx } from '../../common/auth.types';
import { fmtDateTimeBogota, fmtDMY, MONTHS_ES, MONTHS_ES_SHORT } from '../../common/dates';
import { InstitutionalPdf } from '../../common/pdf';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { ActivityFilters, DISPLAY_STATUS_LABELS, DisplayStatus, MatrixView, PlansService, SCHEDULE_TYPE_LABEL } from './plans.service';

export const STATUS_SYMBOL: Record<DisplayStatus, string> = {
  PROGRAMADO: 'P', PROXIMO: 'X', EN_EJECUCION: 'E', EJECUTADO: '✓', VENCIDO: 'V', REPROGRAMADO: 'R', CANCELADO: 'C', NO_APLICA: 'NA',
};
// Para PDF (Helvetica no tiene ✓)
const PDF_SYMBOL: Record<DisplayStatus, string> = { ...STATUS_SYMBOL, EJECUTADO: 'OK' };
const STATUS_RGB: Record<DisplayStatus, [number, number, number]> = {
  PROGRAMADO: [219, 234, 254], PROXIMO: [254, 243, 199], EN_EJECUCION: [224, 231, 255], EJECUTADO: [209, 250, 229],
  VENCIDO: [254, 202, 202], REPROGRAMADO: [237, 233, 254], CANCELADO: [229, 231, 235], NO_APLICA: [243, 244, 246],
};
type MatrixCellLike = { day: number; status: DisplayStatus; count: number; executed: number; rescheduled: boolean };
/** Texto de una celda: día del mes; en filas agrupadas, equipos ejecutados / equipos programados. */
const cellText = (x: MatrixCellLike, grouped: boolean, symbols: Record<DisplayStatus, string> = PDF_SYMBOL) =>
  grouped ? `${x.day} · ${x.executed ? `${x.executed}/${x.count}` : x.count}${x.rescheduled ? ' R' : ''}` : `${x.day}${symbols[x.status]}`;
const monthStatus = (cell: MatrixCellLike[]) => (cell.length ? cell[cell.length - 1].status : null);
const PLAN_STATUS_LABEL: Record<string, string> = { BORRADOR: 'Borrador', EN_REVISION: 'En revisión', APROBADO: 'Aprobado', CERRADO: 'Cerrado' };

const hex = (rgb: [number, number, number]) => 'FF' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();

@Injectable()
export class PlanExportService {
  constructor(
    private readonly plans: PlansService,
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
  ) {}

  private async context(ctx: ReqCtx, year: number, f: ActivityFilters, view: MatrixView = 'grupos', withDetail = true) {
    const [matrix, summary, plan, institution, nit, color, format] = await Promise.all([
      this.plans.matrix(ctx, year, f, view),
      this.plans.summary(ctx, year, f),
      this.plans.getPlan(year),
      this.settings.get<string>('institution.name'),
      this.settings.get<string>('institution.nit'),
      this.settings.get<string>('institution.primaryColor'),
      this.prisma.documentFormat.findUnique({ where: { code: 'F-02' } }),
    ]);
    const detail = withDetail ? (await this.plans.allActivities(ctx, year, f)).items : [];
    return { matrix, summary, plan: plan!, institution, nit, color, format, detail };
  }

  async filtersText(f: ActivityFilters) {
    const parts: string[] = [];
    if (f.month) parts.push(`Mes: ${MONTHS_ES[f.month - 1]}`);
    if (f.areaId) parts.push(`Área: ${(await this.prisma.area.findUnique({ where: { id: f.areaId } }))?.name}`);
    if (f.categoryId) parts.push(`Categoría: ${(await this.prisma.assetCategory.findUnique({ where: { id: f.categoryId } }))?.name}`);
    if (f.assetId) parts.push(`Activo: ${(await this.prisma.asset.findUnique({ where: { id: f.assetId } }))?.code}`);
    if (f.responsibleId) parts.push(`Responsable: ${(await this.prisma.user.findUnique({ where: { id: f.responsibleId } }))?.fullName}`);
    if (f.criticality) parts.push(`Criticidad: ${f.criticality}`);
    if (f.status) parts.push(`Estado: ${DISPLAY_STATUS_LABELS[f.status]}`);
    if (f.kind) parts.push(`Tipo: ${f.kind}`);
    if (f.q) parts.push(`Búsqueda: "${f.q}"`);
    // el tipo de cronograma va en el título, no en los filtros
    return parts.join(' · ');
  }

  // ------------------------------------------------------------------ PDF
  /**
   * Cronograma en una sola hoja: encabezado institucional, control documental, matriz anual por grupos
   * (o por equipo), totales mensuales, leyenda y firmas. La fuente se ajusta para que la matriz quepa en la página.
   * Con annex = true se agrega, en hojas siguientes, el detalle de actividades por equipo.
   */
  async pdf(ctx: ReqCtx, year: number, f: ActivityFilters, paper: 'a4' | 'a3' = 'a4', view: MatrixView = 'grupos', annex = false): Promise<Buffer> {
    const c = await this.context(ctx, year, f, view, annex);
    const filters = await this.filtersText(f);
    const grouped = view === 'grupos';
    const pdf = new InstitutionalPdf(
      {
        institution: c.institution,
        institutionNit: c.nit,
        title: scheduleTitle(f, c.plan.title),
        subtitle: `Año ${year} · Estado: ${PLAN_STATUS_LABEL[c.plan.status]} · ${grouped ? 'Vista por grupos' : 'Vista por equipo'}${filters ? ` · ${filters}` : ''}`,
        documentCode: c.plan.documentCode,
        version: String(c.plan.version),
        effectiveDate: c.format ? fmtDMY(c.format.effectiveDate) : undefined,
        primaryColor: c.color,
        generatedBy: ctx.user.fullName,
      },
      { orientation: 'landscape', format: paper },
    );
    const isA3 = paper === 'a3';

    pdf.keyValues(
      [
        ['Elaboró', c.plan.createdBy ?? '—'],
        ['Revisó', c.plan.reviewedBy ?? '—'],
        ['Aprobó', c.plan.approvedBy ? `${c.plan.approvedBy} (${fmtDMY(c.plan.approvedAt)})` : 'Pendiente de aprobación'],
        [grouped ? 'Grupos / equipos' : 'Equipos', grouped ? `${c.matrix.rows.length} / ${c.matrix.assetCount}` : c.matrix.assetCount],
        ['Actividades', c.matrix.total],
        ['Ejecutadas', `${c.matrix.executed}${c.matrix.total ? ` (${((c.matrix.executed / c.matrix.total) * 100).toFixed(0)} %)` : ''}`],
      ],
      3,
    );
    pdf.section(grouped ? 'Cronograma anual por grupos de mantenimiento' : 'Cronograma anual por equipo');

    // --- Matriz
    const head = grouped
      ? ['Grupo', 'Actividad', 'Equipos', 'Periodicidad', 'Responsable', ...MONTHS_ES_SHORT, 'Total']
      : ['Equipo', 'Grupo / actividad', 'Área', 'Periodicidad', 'Responsable', ...MONTHS_ES_SHORT, 'Total'];
    const body: (string | number)[][] = c.matrix.rows.map((r) => [
      grouped ? r.targetName : `${r.assetCode} · ${r.assetName}`,
      grouped ? r.programName : `${r.targetName} · ${r.programName}`,
      grouped ? r.assetCount : r.areaName,
      r.frequency,
      r.responsible ?? '—',
      ...r.months.map((cell) => cell.map((x) => cellText(x, grouped)).join('\n')),
      r.total,
    ]);
    const hasRows = body.length > 0;
    if (hasRows) body.push(['TOTAL', '', grouped ? c.matrix.assetCount : '', '', '', ...c.matrix.monthTotals.map((m) => m.total || ''), c.matrix.total]);
    else body.push(['Sin actividades para los filtros seleccionados. Genere el cronograma desde el sistema.', '', '', '', '', ...Array(12).fill(''), '']);
    const cellStatus = c.matrix.rows.map((r) => r.months.map(monthStatus));

    const widths = isA3 ? [60, 68, 16, 40, 32] : [40, 46, 13, 28, 21];
    const totalW = isA3 ? 14 : 11;
    const monthW = (pdf.width - 2 * pdf.margin - widths.reduce((s, w) => s + w, 0) - totalW) / 12;
    const colWidths = [...widths, ...Array(12).fill(monthW), totalW];

    // Espacio disponible para que matriz, leyenda y firmas quepan en la primera hoja
    const reservedBelow = 16 + 9 + 24; // pie + leyenda + firmas
    const available = pdf.height - pdf.y - 4 - reservedBelow;
    const padding = 0.8;
    const estimate = (fs: number) => {
      pdf.doc.setFontSize(fs);
      const lineH = fs * 0.3528 * 1.15;
      const rowsH = body.map((row) => Math.max(...row.map((v, i) => pdf.doc.splitTextToSize(String(v), colWidths[i] - 2 * padding).length)) * lineH + 2 * padding);
      return rowsH.reduce((s, h) => s + h, 0) + 2 * lineH + 2 * padding; // + encabezado (2 líneas)
    };
    let fontSize = isA3 ? 8.5 : 7.5;
    while (fontSize > 4.6 && estimate(fontSize) > available) fontSize -= 0.25;

    pdf.table({
      head: [head],
      body,
      styles: { fontSize, cellPadding: padding, overflow: 'linebreak', valign: 'middle' },
      headStyles: { fontSize: Math.max(fontSize, 5.5) },
      columnStyles: {
        ...Object.fromEntries(colWidths.map((w, i) => [i, { cellWidth: w }])),
        0: { cellWidth: colWidths[0], fontStyle: 'bold' },
        2: { cellWidth: colWidths[2], halign: 'center' },
        ...Object.fromEntries(Array.from({ length: 13 }, (_, i) => [i + 5, { cellWidth: colWidths[i + 5], halign: 'center' as const }])),
      },
      didParseCell: (d) => {
        if (d.section !== 'body') return;
        const isTotal = hasRows && d.row.index === body.length - 1;
        if (isTotal) {
          d.cell.styles.fontStyle = 'bold';
          d.cell.styles.fillColor = [226, 232, 240];
          return;
        }
        if (d.column.index >= 5 && d.column.index < 17 && hasRows) {
          const st = cellStatus[d.row.index]?.[d.column.index - 5];
          if (st) d.cell.styles.fillColor = STATUS_RGB[st];
        }
        if (d.column.index === 17) d.cell.styles.fontStyle = 'bold';
      },
    });

    // --- Leyenda compacta
    const legend = (Object.keys(STATUS_RGB) as DisplayStatus[]).filter((k) => k !== 'NO_APLICA');
    const doc = pdf.doc;
    let lx = pdf.margin;
    const ly = Math.min(pdf.y + 5, pdf.height - 16 - 24 - 2);
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'bold');
    doc.text('Estados:', lx, ly);
    lx += 12;
    doc.setFont('helvetica', 'normal');
    for (const k of legend) {
      const label = grouped ? DISPLAY_STATUS_LABELS[k] : `${PDF_SYMBOL[k]} ${DISPLAY_STATUS_LABELS[k]}`;
      const w = doc.getTextWidth(label) + 4;
      doc.setFillColor(...STATUS_RGB[k]);
      doc.rect(lx, ly - 2.6, w, 3.6, 'F');
      doc.text(label, lx + 2, ly);
      lx += w + 1.5;
    }
    doc.setTextColor(80);
    doc.text(grouped
      ? 'Celda: día del mes · equipos (ejecutados/programados). R = reprogramada. Color = estado más urgente del grupo.'
      : 'Celda: día del mes y estado. Las fechas reprogramadas conservan la fecha original en el sistema.', lx + 3, ly);
    doc.setTextColor(20);

    // --- Firmas compactas en la misma hoja
    const sy = ly + 17;
    const sw = (pdf.width - 2 * pdf.margin) / 3;
    [['Elaboró', c.plan.createdBy], ['Revisó', c.plan.reviewedBy], ['Aprobó', c.plan.approvedBy]].forEach(([role, name], i) => {
      const x = pdf.margin + i * sw;
      doc.setDrawColor(60);
      doc.line(x + 10, sy, x + sw - 10, sy);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.text(String(role), x + sw / 2, sy + 3.5, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      if (name) doc.text(String(name), x + sw / 2, sy + 7, { align: 'center' });
    });
    pdf.setY(sy + 8);

    // --- Anexo opcional: detalle por equipo
    if (annex) {
      pdf.addPage();
      pdf.section('Anexo · Detalle de actividades por equipo');
      pdf.table({
        head: [['Fecha', 'Fecha original', 'Código', 'Equipo', 'Área', 'Mantenimiento', 'Responsable', 'Estado', 'Ejecución', 'OT']],
        body: c.detail.map((a) => [
          fmtDMY(a.committedDate), a.rescheduled ? fmtDMY(a.originalDate) : '=', a.asset.code, a.asset.name, a.asset.area.name,
          a.program.name, a.responsible?.fullName ?? '—', a.displayStatusLabel, a.executedDate ? fmtDMY(a.executedDate) : '', a.workOrder?.code ?? '',
        ]),
        styles: { fontSize: isA3 ? 7.5 : 6.8 },
        columnStyles: { 0: { cellWidth: 18 }, 1: { cellWidth: 18 }, 2: { cellWidth: 24 }, 8: { cellWidth: 18 } },
      });
    }
    return pdf.finalize();
  }

  // ------------------------------------------------------------------ Excel
  async xlsx(ctx: ReqCtx, year: number, f: ActivityFilters, view: MatrixView = 'grupos'): Promise<Buffer> {
    const c = await this.context(ctx, year, f, view);
    const filters = await this.filtersText(f);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'SIGM';
    wb.created = new Date();
    const brand = 'FF' + (c.color || '#0f5c7a').replace('#', '').toUpperCase();
    const headStyle = (row: ExcelJS.Row) => {
      row.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: brand } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
      });
      row.height = 30;
    };
    const titleBlock = (ws: ExcelJS.Worksheet, sub: string, cols: number) => {
      ws.mergeCells(1, 1, 1, cols);
      ws.getCell(1, 1).value = c.institution;
      ws.getCell(1, 1).font = { bold: true, size: 13, color: { argb: brand } };
      ws.mergeCells(2, 1, 2, cols);
      ws.getCell(2, 1).value = `${scheduleTitle(f, c.plan.title)} ${year} — ${sub}`;
      ws.getCell(2, 1).font = { bold: true, size: 12 };
      ws.mergeCells(3, 1, 3, cols);
      ws.getCell(3, 1).value = `Código: ${c.plan.documentCode} · Versión: ${c.plan.version} · Estado: ${PLAN_STATUS_LABEL[c.plan.status]} · Generado: ${fmtDateTimeBogota(new Date())} por ${ctx.user.fullName}${filters ? ` · Filtros: ${filters}` : ''}`;
      ws.getCell(3, 1).font = { size: 9, color: { argb: 'FF555555' } };
    };

    // Hoja 1: Resumen anual
    const s1 = wb.addWorksheet('Resumen anual', { pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1 } });
    titleBlock(s1, 'Resumen anual', 8);
    s1.addRow([]);
    const ctrl = [
      ['Elaboró', c.plan.createdBy ?? ''], ['Revisó', c.plan.reviewedBy ?? ''], ['Aprobó', c.plan.approvedBy ?? 'Pendiente'],
      ['Fecha de aprobación', c.plan.approvedAt ? fmtDateTimeBogota(c.plan.approvedAt) : ''],
    ];
    ctrl.forEach((r) => {
      const row = s1.addRow(r);
      row.getCell(1).font = { bold: true };
    });
    s1.addRow([]);
    const h1 = s1.addRow(['Categoría', 'Total', 'Ejecutadas', 'Vencidas', 'Reprogramadas', 'Canceladas', 'No aplica', '% ejecución']);
    headStyle(h1);
    const firstData = h1.number + 1;
    for (const [name, v] of Object.entries(c.summary.byCategory)) {
      const r = s1.addRow([name, v.total, v.executed, v.byStatus.VENCIDO ?? 0, v.byStatus.REPROGRAMADO ?? 0, v.byStatus.CANCELADO ?? 0, v.byStatus.NO_APLICA ?? 0]);
      r.getCell(8).value = { formula: `IF(B${r.number}=0,"",C${r.number}/B${r.number})` };
      r.getCell(8).numFmt = '0.0%';
    }
    const last = s1.lastRow!.number;
    const tot = s1.addRow(['TOTAL']);
    for (let col = 2; col <= 7; col++) {
      const L = String.fromCharCode(64 + col);
      tot.getCell(col).value = { formula: `SUM(${L}${firstData}:${L}${Math.max(last, firstData)})` };
    }
    tot.getCell(8).value = { formula: `IF(B${tot.number}=0,"",C${tot.number}/B${tot.number})` };
    tot.getCell(8).numFmt = '0.0%';
    tot.font = { bold: true };
    s1.addRow([]);
    const hm = s1.addRow(['Mes', 'Programadas', 'Ejecutadas']);
    headStyle(hm);
    c.summary.byMonth.forEach((m, i) => s1.addRow([MONTHS_ES[i], m.total, m.executed]));
    s1.columns.forEach((col, i) => (col.width = i === 0 ? 34 : 15));

    // Hoja 2: Cronograma mensual (matriz)
    // Una sola hoja impresa (ancho y alto ajustados a la página)
    const s2 = wb.addWorksheet('Cronograma mensual', { views: [{ state: 'frozen', xSplit: 3, ySplit: 5 }], pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 1 } });
    titleBlock(s2, view === 'grupos' ? 'Cronograma por grupos' : 'Cronograma por equipo', 19);
    s2.addRow([]);
    const grouped = view === 'grupos';
    const h2 = s2.addRow(grouped
      ? ['Grupo', 'Tipo de agrupación', 'Actividad', 'Equipos', 'Área', 'Periodicidad', ...MONTHS_ES, 'Total']
      : ['Código activo', 'Activo', 'Grupo / mantenimiento', 'Área', 'Categoría', 'Periodicidad', ...MONTHS_ES, 'Total']);
    headStyle(h2);
    for (const r of c.matrix.rows) {
      const row = s2.addRow([
        ...(grouped
          ? [r.targetName, r.groupType, r.programName, r.assetCount, r.areaName, r.frequency]
          : [r.assetCode, r.assetName, `${r.targetName} · ${r.programName}`, r.areaName, r.categoryName, r.frequency]),
        ...r.months.map((cell) => cell.map((x) => cellText(x, grouped, STATUS_SYMBOL)).join('\n')),
        r.total,
      ]);
      r.months.forEach((cell, i) => {
        const xc = row.getCell(7 + i);
        xc.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        const st = monthStatus(cell);
        if (st) xc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hex(STATUS_RGB[st]) } };
      });
    }
    const totalRow = s2.addRow(['TOTAL', '', '', grouped ? c.matrix.assetCount : '', '', '', ...c.matrix.monthTotals.map((m) => m.total), c.matrix.total]);
    totalRow.font = { bold: true };
    s2.autoFilter = { from: { row: h2.number, column: 1 }, to: { row: h2.number, column: 19 } };
    s2.columns.forEach((col, i) => (col.width = i < 6 ? [14, 30, 34, 20, 20, 16][i] : i === 18 ? 8 : 9));
    s2.addRow([]);
    s2.addRow([(grouped ? 'Celdas: día · equipos (ejecutados/programados). Color = estado más urgente del grupo. ' : '') + 'Leyenda: ' + Object.entries(STATUS_SYMBOL).map(([k, s]) => `${s} = ${DISPLAY_STATUS_LABELS[k as DisplayStatus]}`).join(' · ')]);

    // Hoja 3: Detalle de actividades
    const s3 = wb.addWorksheet('Detalle de actividades', { views: [{ state: 'frozen', ySplit: 5 }] });
    titleBlock(s3, 'Detalle de actividades', 15);
    s3.addRow([]);
    const h3 = s3.addRow(['Fecha comprometida', 'Fecha original aprobada', 'Fecha de ejecución', 'Mes', 'Código activo', 'Activo', 'Área', 'Categoría', 'Criticidad', 'Programa', 'Mantenimiento', 'Responsable', 'Estado', 'Reprogramada', 'Orden de trabajo']);
    headStyle(h3);
    const toDate = (s: string | null) => (s ? new Date(`${s}T12:00:00Z`) : null);
    for (const a of c.detail) {
      const r = s3.addRow([
        toDate(a.committedDate), toDate(a.originalDate), toDate(a.executedDate), MONTHS_ES[Number(a.committedDate.slice(5, 7)) - 1],
        a.asset.code, a.asset.name, a.asset.area.name, a.asset.category.name, a.asset.criticality, a.program.code, a.program.name,
        a.responsible?.fullName ?? '', a.displayStatusLabel, a.rescheduled ? 'Sí' : 'No', a.workOrder?.code ?? '',
      ]);
      [1, 2, 3].forEach((i) => (r.getCell(i).numFmt = 'dd/mm/yyyy'));
      r.getCell(13).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hex(STATUS_RGB[a.displayStatus]) } };
    }
    s3.autoFilter = { from: { row: h3.number, column: 1 }, to: { row: h3.number, column: 15 } };
    s3.columns.forEach((col, i) => (col.width = [14, 14, 14, 12, 14, 30, 20, 20, 11, 12, 34, 24, 14, 12, 16][i]));
    const totRow = s3.addRow(['Total actividades', c.detail.length]);
    totRow.font = { bold: true };

    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}

/** Título del documento según el cronograma solicitado */
export function scheduleTitle(f: ActivityFilters, planTitle?: string | null) {
  if (f.scheduleType) return `CRONOGRAMA DE MANTENIMIENTO ${SCHEDULE_TYPE_LABEL[f.scheduleType].toUpperCase()}`;
  return planTitle || 'PLAN ANUAL DE MANTENIMIENTO';
}
