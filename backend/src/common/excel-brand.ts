import type ExcelJS from 'exceljs';
import { INSTITUTION_LOGOS } from './pdf';

/**
 * Encabezado de marca para hojas de Excel: deja la fila 1 alta y ubica los logos institucionales
 * (POSMEDICA a la izquierda, UNO-P a la derecha) sin tapar el texto centrado de la fila.
 */
export function addExcelLogos(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, lastCol: number) {
  const height = 46; // px
  ws.getRow(1).height = 40; // pt ≈ 53 px
  const cell = ws.getCell(1, 1);
  cell.alignment = { ...(cell.alignment ?? {}), horizontal: 'center', vertical: 'middle' };
  INSTITUTION_LOGOS.forEach((logo, i) => {
    const id = wb.addImage({ base64: logo.data, extension: 'jpeg' });
    const width = Math.round(height * (logo.width / logo.height));
    // el primero en la esquina izquierda; el último pegado al borde derecho de la última columna
    const col = i === 0 ? 0.1 : Math.max(1, lastCol - width / 64 - 0.1);
    ws.addImage(id, { tl: { col, row: 0.08 }, ext: { width, height }, editAs: 'oneCell' });
  });
}
