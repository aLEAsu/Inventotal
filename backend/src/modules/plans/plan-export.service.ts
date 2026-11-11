import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { ReqCtx } from '../../common/auth.types';
import { fmtDateTimeBogota, fmtDMY, MONTHS_ES, MONTHS_ES_SHORT } from '../../common/dates';
import { InstitutionalPdf } from '../../common/pdf';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { ActivityFilters, DISPLAY_STATUS_LABELS, DisplayStatus, PlansService } from './plans.service';

export const STATUS_SYMBOL: Record<DisplayStatus, string> = {
  PROGRAMADO: 'P', PROXIMO: 'X', EN_EJECUCION: 'E', EJECUTADO: '✓', VENCIDO: 'V', REPROGRAMADO: 'R', CANCELADO: 'C', NO_APLICA: 'NA',
};
// Para PDF (Helvetica no tiene ✓)
const PDF_SYMBOL: Record<DisplayStatus, string> = { ...STATUS_SYMBOL, EJECUTADO: 'OK' };
const STATUS_RGB: Record<DisplayStatus, [number, number, number]> = {
  PROGRAMADO: [219, 234, 254], PROXIMO: [254, 243, 199], EN_EJECUCION: [224, 231, 255], EJECUTADO: [209, 250, 229],
  VENCIDO: [254, 202, 202], REPROGRAMADO: [237, 233, 254], CANCELADO: [229, 231, 235], NO_APLICA: [243, 244, 246],
};
const PLAN_STATUS_LABEL: Record<string, string> = { BORRADOR: 'Borrador', EN_REVISION: 'En revisión', APROBADO: 'Aprobado', CERRADO: 'Cerrado' };

const hex = (rgb: [number, number, number]) => 'FF' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();

@Injectable()
export class PlanExportService {
  constructor(
    private readonly plans: PlansService,
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
  ) {}

  private async context(ctx: ReqCtx, year: number, f: ActivityFilters) {
    const [matrix, summary, plan, institution, nit, color, format] = await Promise.all([
      this.plans.matrix(ctx, year, f),
      this.plans.summary(ctx, year, f),
      this.plans.getPlan(year),
      this.settings.get<string>('institution.name'),
      this.settings.get<string>('institution.nit'),
      this.settings.get<string>('institution.primaryColor'),
      this.prisma.documentFormat.findUnique({ where: { code: 'F-02' } }),
    ]);
    const detail = await this.plans.allActivities(ctx, year, f);
    return { matrix, summary, plan: plan!, institution, nit, color, format, detail: detail.items };
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
    return parts.join(' · ');
  }

  // ------------------------------------------------------------------ PDF
  async pdf(ctx: ReqCtx, year: number, f: ActivityFilters, paper: 'a4' | 'a3' = 'a4'): Promise<Buffer> {
    const c = await this.context(ctx, year, f);
    const filters = await this.filtersText(f);
    const pdf = new InstitutionalPdf(
      {
        institution: c.institution,
        institutionNit: c.nit,
        title: c.plan.title || 'PLAN ANUAL DE MANTENIMIENTO',
        subtitle: `Año ${year} · Estado: ${PLAN_STATUS_LABEL[c.plan.status]}${filters ? ` · Filtros: ${filters}` : ''}`,
        documentCode: c.plan.documentCode,
        version: String(c.plan.version),
        effectiveDate: c.format ? fmtDMY(c.format.effectiveDate) : undefined,
        primaryColor: c.color,
        generatedBy: ctx.user.fullName,
      },
      { orientation: 'landscape', format: paper },
    );

    // Control documental
    pdf.keyValues(
      [
        ['Año', year],
        ['Versión', c.plan.version],
        ['Estado documental', PLAN_STATUS_LABEL[c.plan.status]],
        ['Fecha de generación', fmtDateTimeBogota(new Date())],
        ['Elaboró', c.plan.createdBy ?? '—'],
        ['Revisó', c.plan.reviewedBy ?? '—'],
        ['Aprobó', c.plan.approvedBy ? `${c.plan.approvedBy} (${fmtDateTimeBogota(c.plan.approvedAt)})` : 'Pendiente de aprobación'],
        ['Total de actividades', c.summary.total],
      ],
      4,
    );

    // Matriz anual
    pdf.section('Cronograma anual (vista matricial)');
    const isA3 = paper === 'a3';
    const body = c.matrix.rows.map((r) => [
      r.assetCode,
      `${r.assetName}\n${r.programName}`,
      r.areaName,
      r.frequency,
      r.responsible ?? '—',
      ...r.months.map((cell) => cell.map((x) => `${x.day}${PDF_SYMBOL[x.status]}`).join(' ')),
    ]);
    const monthCellStatus = c.matrix.rows.map((r) => r.months.map((cell) => (cell.length ? cell[cell.length - 1].status : null)));
    pdf.table({
      head: [['Código', 'Activo / Mantenimiento', 'Área', 'Periodicidad', 'Responsable', ...MONTHS_ES_SHORT]],
      body: body.length ? body : [['', 'Sin actividades para los filtros seleccionados', '', '', '', ...Array(12).fill('')]],
      styles: { fontSize: isA3 ? 7.5 : 6.3, cellPadding: 1, overflow: 'linebreak', valign: 'middle' },
      columnStyles: {
        0: { cellWidth: isA3 ? 28 : 23, fontSize: isA3 ? 7 : 5.8 },
        1: { cellWidth: isA3 ? 80 : 56 },
        2: { cellWidth: isA3 ? 30 : 21 },
        3: { cellWidth: isA3 ? 24 : 17 },
        4: { cellWidth: isA3 ? 30 : 20 },
        ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 5, { halign: 'center' as const }])),
      },
      didParseCell: (d) => {
        if (d.section === 'body' && d.column.index >= 5 && body.length) {
          const st = monthCellStatus[d.row.index]?.[d.column.index - 5];
          if (st) d.cell.styles.fillColor = STATUS_RGB[st];
        }
      },
    });

    // Leyenda
    pdf.section('Leyenda de estados');
    pdf.table({
      body: [Object.entries(PDF_SYMBOL).map(([k, s]) => `${s} = ${DISPLAY_STATUS_LABELS[k as DisplayStatus]}`)],
      styles: { fontSize: 7, halign: 'center' },
      didParseCell: (d) => {
        const k = Object.keys(PDF_SYMBOL)[d.column.index] as DisplayStatus;
        if (k) d.cell.styles.fillColor = STATUS_RGB[k];
      },
    });
    pdf.paragraph('El número indica el día del mes de la fecha comprometida. "R" señala fechas reprogramadas y aprobadas; la fecha originalmente aprobada se conserva en el detalle.', 7);

    // Totales por categoría
    pdf.section('Resumen por categoría');
    const cats = Object.entries(c.summary.byCategory);
    pdf.table({
      head: [['Categoría', 'Total', 'Ejecutadas', 'Vencidas', 'Reprogramadas', 'Canceladas / No aplica', '% ejecución']],
      body: [
        ...cats.map(([name, v]) => [
          name, v.total, v.executed, v.byStatus.VENCIDO ?? 0, v.byStatus.REPROGRAMADO ?? 0,
          (v.byStatus.CANCELADO ?? 0) + (v.byStatus.NO_APLICA ?? 0), v.total ? `${((v.executed / v.total) * 100).toFixed(1)} %` : '—',
        ]),
        ['TOTAL', c.summary.total, cats.reduce((s, [, v]) => s + v.executed, 0), c.summary.byStatus.VENCIDO ?? 0, c.summary.byStatus.REPROGRAMADO ?? 0,
          (c.summary.byStatus.CANCELADO ?? 0) + (c.summary.byStatus.NO_APLICA ?? 0), ''],
      ],
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
      didParseCell: (d) => {
        if (d.section === 'body' && d.row.index === cats.length) d.cell.styles.fontStyle = 'bold';
      },
    });
    pdf.section('Actividades por mes');
    pdf.table({
      head: [MONTHS_ES_SHORT.concat('TOTAL')],
      body: [c.summary.byMonth.map((m) => m.total).concat(c.summary.total)],
      styles: { halign: 'center' },
    });

    // Detalle
    pdf.addPage();
    pdf.section('Detalle de actividades programadas');
    pdf.table({
      head: [['Fecha comprometida', 'Fecha original', 'Código', 'Activo', 'Área', 'Mantenimiento', 'Responsable', 'Estado', 'Ejecución', 'OT']],
      body: c.detail.map((a) => [
        fmtDMY(a.committedDate), a.rescheduled ? fmtDMY(a.originalDate) : '=', a.asset.code, a.asset.name, a.asset.area.name,
        a.program.name, a.responsible?.fullName ?? '—', a.displayStatusLabel, a.executedDate ? fmtDMY(a.executedDate) : '', a.workOrder?.code ?? '',
      ]),
      styles: { fontSize: isA3 ? 7.5 : 6.8 },
      columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 18 }, 2: { cellWidth: 24 }, 8: { cellWidth: 18 } },
    });

    pdf.signatures([
      { role: 'Elaboró', name: c.plan.createdBy, detail: 'Coordinación de mantenimiento' },
      { role: 'Revisó', name: c.plan.reviewedBy },
      { role: 'Aprobó', name: c.plan.approvedBy },
    ]);
    return pdf.finalize();
  }

  // ------------------------------------------------------------------ Excel
  async xlsx(ctx: ReqCtx, year: number, f: ActivityFilters): Promise<Buffer> {
    const c = await this.context(ctx, year, f);
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
      ws.getCell(2, 1).value = `${c.plan.title || 'PLAN ANUAL DE MANTENIMIENTO'} ${year} — ${sub}`;
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
    const s2 = wb.addWorksheet('Cronograma mensual', { views: [{ state: 'frozen', xSplit: 4, ySplit: 5 }], pageSetup: { orientation: 'landscape', paperSize: 8 as never, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    titleBlock(s2, 'Cronograma mensual', 18);
    s2.addRow([]);
    const h2 = s2.addRow(['Código activo', 'Activo', 'Mantenimiento', 'Área', 'Categoría', 'Periodicidad', ...MONTHS_ES, 'Total']);
    headStyle(h2);
    for (const r of c.matrix.rows) {
      const row = s2.addRow([
        r.assetCode, r.assetName, r.programName, r.areaName, r.categoryName, r.frequency,
        ...r.months.map((cell) => cell.map((x) => `${String(x.day).padStart(2, '0')} ${STATUS_SYMBOL[x.status]}`).join('\n')),
        r.months.reduce((s, cell) => s + cell.length, 0),
      ]);
      r.months.forEach((cell, i) => {
        const xc = row.getCell(7 + i);
        xc.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        if (cell.length) xc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hex(STATUS_RGB[cell[cell.length - 1].status]) } };
      });
    }
    s2.autoFilter = { from: { row: h2.number, column: 1 }, to: { row: h2.number, column: 19 } };
    s2.columns.forEach((col, i) => (col.width = i < 6 ? [14, 30, 34, 20, 20, 16][i] : i === 18 ? 8 : 9));
    s2.addRow([]);
    s2.addRow(['Leyenda: ' + Object.entries(STATUS_SYMBOL).map(([k, s]) => `${s} = ${DISPLAY_STATUS_LABELS[k as DisplayStatus]}`).join(' · ')]);

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
