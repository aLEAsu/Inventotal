import { jsPDF } from 'jspdf';
import { autoTable, type UserOptions } from 'jspdf-autotable';
import { fmtDateTimeBogota } from './dates';

export interface DocHeader {
  institution: string;
  institutionNit?: string;
  title: string;
  subtitle?: string;
  documentCode: string;
  version: string;
  effectiveDate?: string;
  primaryColor?: string;
  generatedBy?: string;
}

export interface PdfOptions {
  orientation?: 'portrait' | 'landscape';
  format?: 'a4' | 'a3' | 'letter';
}

function hexToRgb(hex = '#0f5c7a'): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/**
 * Documento institucional: encabezado con nombre de la institución, título, código documental,
 * versión, fecha de vigencia y fecha de generación; pie con numeración "Página X de Y".
 * El encabezado se repite en cada página (las tablas reservan el margen superior).
 */
export class InstitutionalPdf {
  readonly doc: jsPDF;
  readonly color: [number, number, number];
  readonly headerHeight = 28;
  readonly margin = 10;
  private readonly headerDrawn = new Set<number>();

  constructor(
    readonly header: DocHeader,
    opts: PdfOptions = {},
  ) {
    this.doc = new jsPDF({ orientation: opts.orientation ?? 'portrait', unit: 'mm', format: opts.format ?? 'a4', compress: true });
    this.color = hexToRgb(header.primaryColor);
    this.doc.setProperties({ title: `${header.title} ${header.subtitle ?? ''}`.trim(), creator: 'SIGM', author: header.institution });
    this.drawHeader();
  }

  get width() {
    return this.doc.internal.pageSize.getWidth();
  }
  get height() {
    return this.doc.internal.pageSize.getHeight();
  }
  get contentTop() {
    return this.margin + this.headerHeight + 4;
  }
  get y(): number {
    return (this.doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? this.contentTop;
  }

  drawHeader() {
    const d = this.doc;
    this.headerDrawn.add(d.getCurrentPageInfo().pageNumber);
    const m = this.margin;
    const w = this.width - 2 * m;
    const h = this.headerHeight;
    d.setDrawColor(120);
    d.setLineWidth(0.3);
    d.rect(m, m, w, h);
    const left = w * 0.3;
    const right = w * 0.25;
    d.line(m + left, m, m + left, m + h);
    d.line(m + w - right, m, m + w - right, m + h);
    // Institución
    d.setTextColor(...this.color);
    d.setFont('helvetica', 'bold');
    d.setFontSize(10.5);
    d.text(d.splitTextToSize(this.header.institution, left - 6), m + left / 2, m + 10, { align: 'center' });
    if (this.header.institutionNit) {
      d.setFont('helvetica', 'normal');
      d.setFontSize(7.5);
      d.setTextColor(80);
      d.text(`NIT ${this.header.institutionNit}`, m + left / 2, m + h - 4, { align: 'center' });
    }
    // Título
    d.setTextColor(20);
    d.setFont('helvetica', 'bold');
    d.setFontSize(12.5);
    const cx = m + left + (w - left - right) / 2;
    d.text(this.header.title, cx, m + 11, { align: 'center' });
    if (this.header.subtitle) {
      d.setFont('helvetica', 'normal');
      d.setFontSize(9.5);
      d.text(d.splitTextToSize(this.header.subtitle, w - left - right - 6), cx, m + 18, { align: 'center' });
    }
    // Control documental
    d.setFontSize(7.5);
    d.setFont('helvetica', 'normal');
    d.setTextColor(40);
    const rx = m + w - right + 3;
    const lines = [
      `Código: ${this.header.documentCode}`,
      `Versión: ${this.header.version}`,
      this.header.effectiveDate ? `Vigencia: ${this.header.effectiveDate}` : '',
      `Generado: ${fmtDateTimeBogota(new Date())}`,
    ].filter(Boolean);
    lines.forEach((t, i) => d.text(t, rx, m + 6 + i * 5.5));
    d.setTextColor(20);
  }

  addPage() {
    this.doc.addPage();
    this.drawHeader();
    (this.doc as unknown as { lastAutoTable?: unknown }).lastAutoTable = undefined;
  }

  ensureSpace(mm: number) {
    if (this.y + mm > this.height - 16) this.addPage();
  }

  section(title: string) {
    this.ensureSpace(14);
    const y = this.y + 6;
    this.doc.setFillColor(...this.color);
    this.doc.rect(this.margin, y - 4.2, this.width - 2 * this.margin, 6, 'F');
    this.doc.setTextColor(255);
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(9);
    this.doc.text(title.toUpperCase(), this.margin + 2, y);
    this.doc.setTextColor(20);
    this.setY(y + 2);
  }

  setY(y: number) {
    (this.doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable = { finalY: y } as never;
  }

  /** Tabla con encabezado repetido en cada página y filas que no se parten. */
  table(opts: UserOptions) {
    const baseStyles = { font: 'helvetica', fontSize: 7.5, cellPadding: 1.4, lineColor: [170, 170, 170], lineWidth: 0.15, textColor: 20, overflow: 'linebreak' } as const;
    const baseHead = { fillColor: this.color, textColor: 255, fontStyle: 'bold', halign: 'center', valign: 'middle' } as const;
    autoTable(this.doc, {
      startY: this.y + 2,
      margin: { top: this.contentTop, left: this.margin, right: this.margin, bottom: 16 },
      theme: 'grid',
      showHead: 'everyPage',
      rowPageBreak: 'avoid',

      alternateRowStyles: { fillColor: [246, 248, 250] },
      didDrawPage: () => {
        // páginas nuevas creadas por autoTable: repetir encabezado institucional
        if (!this.headerDrawn.has(this.doc.getCurrentPageInfo().pageNumber)) this.drawHeader();
      },
      ...opts,
      // los estilos de cada tabla complementan (no reemplazan) los estilos institucionales base
      styles: { ...baseStyles, ...(opts.styles ?? {}) } as never,
      headStyles: { ...baseHead, ...(opts.headStyles ?? {}) } as never,
    });
  }

  keyValues(rows: [string, string | number | null | undefined][], cols = 2) {
    const body: string[][] = [];
    for (let i = 0; i < rows.length; i += cols) {
      const r: string[] = [];
      for (let j = 0; j < cols; j++) {
        const kv = rows[i + j];
        r.push(kv ? kv[0] : '', kv ? String(kv[1] ?? '—') || '—' : '');
      }
      body.push(r);
    }
    const colStyles: Record<number, Record<string, unknown>> = {};
    for (let j = 0; j < cols; j++) colStyles[j * 2] = { fontStyle: 'bold', fillColor: [236, 241, 245], cellWidth: 35 };
    this.table({ body, theme: 'grid', columnStyles: colStyles as never, alternateRowStyles: {} });
  }

  paragraph(text: string, size = 8.5) {
    const lines = this.doc.splitTextToSize(text || '—', this.width - 2 * this.margin - 4);
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(size);
    let y = this.y + 5;
    for (const ln of lines) {
      if (y > this.height - 18) {
        this.addPage();
        y = this.contentTop + 4;
      }
      this.doc.text(ln, this.margin + 2, y);
      y += size * 0.45;
    }
    this.setY(y);
  }

  signatures(labels: { role: string; name?: string | null; detail?: string | null }[]) {
    this.ensureSpace(34);
    const y0 = this.y + 22;
    const w = (this.width - 2 * this.margin) / labels.length;
    labels.forEach((l, i) => {
      const x = this.margin + i * w;
      this.doc.setDrawColor(60);
      this.doc.line(x + 6, y0, x + w - 6, y0);
      this.doc.setFont('helvetica', 'bold');
      this.doc.setFontSize(8);
      this.doc.text(l.role, x + w / 2, y0 + 4, { align: 'center' });
      this.doc.setFont('helvetica', 'normal');
      if (l.name) this.doc.text(l.name, x + w / 2, y0 + 8, { align: 'center' });
      if (l.detail) this.doc.text(l.detail, x + w / 2, y0 + 12, { align: 'center' });
    });
    this.setY(y0 + 14);
  }

  finalize(): Buffer {
    const total = this.doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      this.doc.setPage(i);
      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(7.5);
      this.doc.setTextColor(90);
      this.doc.text(`${this.header.documentCode} · v${this.header.version}`, this.margin, this.height - 7);
      this.doc.text(`Página ${i} de ${total}`, this.width - this.margin, this.height - 7, { align: 'right' });
      if (this.header.generatedBy) this.doc.text(`Generado por: ${this.header.generatedBy}`, this.width / 2, this.height - 7, { align: 'center' });
    }
    return Buffer.from(this.doc.output('arraybuffer'));
  }
}
