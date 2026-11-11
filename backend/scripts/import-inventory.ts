/**
 * Importador del inventario institucional (formato GTE-FR-001 "Inventario de equipos y mobiliario").
 *
 *   npx ts-node scripts/import-inventory.ts <archivo.xlsx> [--dry-run] [--admin=usuario] [--report=ruta.md]
 *
 * Alcance (decisión institucional): equipos de cómputo, sistemas, periféricos, dispositivos móviles,
 * infraestructura de red/energía de TI y aires acondicionados. El mobiliario y los demás elementos se excluyen.
 *
 * - --dry-run: solo analiza y genera el informe; no escribe en la base de datos.
 * - Importación en UNA transacción (todo o nada), con registro en la bitácora de auditoría.
 * - Idempotente: cada activo guarda la marca "[IMPORT <código formato> fila N]"; las filas ya importadas se omiten.
 * - La columna ACTIVO FIJO (MC-xxx) agrupa los elementos de un puesto y NO es única: se conserva como referencia
 *   y cada equipo recibe un código institucional nuevo por categoría (CMP-0001, PER-0001, ...).
 * - Valores N/R, N/A, NA y vacíos se registran como "sin dato".
 */
import 'dotenv/config';
import ExcelJS from 'exceljs';
import { PrismaPg } from '@prisma/adapter-pg';
import { basename } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '../src/generated/prisma/client';

type Rule = { cat: string; sub: string };

/** Clasificación por nombre de equipo (normalizado sin tildes y en mayúsculas). Orden: la primera coincidencia gana. */
const RULES: [RegExp, Rule][] = [
  [/^TORRE (DE )?PC SERVIDOR/, { cat: 'SRV', sub: 'Servidor físico' }],
  [/^TORRE (DE )?PC/, { cat: 'CMP', sub: 'Escritorio' }],
  [/^COMPUTADOR ALL IN ONE/, { cat: 'CMP', sub: 'Todo en uno' }],
  [/^(COMPUTADOR )?PORTATIL/, { cat: 'CMP', sub: 'Portátil' }],
  [/^TABLET/, { cat: 'MOV', sub: 'Tableta' }],
  [/^CELULAR/, { cat: 'MOV', sub: 'Celular' }],
  [/^MONITOR/, { cat: 'PER', sub: 'Monitor' }],
  [/^IMPRESORA DE ETIQUETAS/, { cat: 'PER', sub: 'Impresora de etiquetas' }],
  [/^IMPRESORA/, { cat: 'PER', sub: 'Impresora' }],
  [/^LECTOR DE CODIGO DE BARRAS/, { cat: 'PER', sub: 'Lector de código de barras' }],
  [/^HUELLERO/, { cat: 'PER', sub: 'Lector biométrico' }],
  [/^MOUSE/, { cat: 'PER', sub: 'Mouse' }],
  [/^TECLADO/, { cat: 'PER', sub: 'Teclado' }],
  [/^TELEVISOR/, { cat: 'PER', sub: 'Televisor / pantalla' }],
  [/^(CAMARA DE VIDEOCONFERENCIA|MICROFONO)/, { cat: 'TEL', sub: 'Videoconferencia' }],
  [/^SWITCH/, { cat: 'RED', sub: 'Switch' }],
  [/^ROUTER/, { cat: 'RED', sub: 'Router' }],
  [/^(SISTEMA MESH WIFI|AMPLIFICADOR WIFI)/, { cat: 'RED', sub: 'Punto de acceso inalámbrico' }],
  [/^UPS/, { cat: 'UPS', sub: 'UPS' }],
  [/^MULTITOMA/, { cat: 'UPS', sub: 'Multitoma' }],
  [/^AIRE ACONDICIONADO/, { cat: 'AAC', sub: 'Mini split' }],
];

const NO_DATA = /^(N\/?R|N\/?A|NA|NINGUNO|-|\s*)$/i;
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
const clean = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = (typeof v === 'object' && 'text' in (v as object) ? String((v as { text: unknown }).text) : String(v)).replace(/\s+/g, ' ').trim();
  return NO_DATA.test(s) ? null : s;
};
const code20 = (s: string) => norm(s).replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20);

interface Row {
  rowNo: number;
  item: string | null;
  mc: string | null;
  equipo: string;
  marca: string | null;
  modelo: string | null;
  serie: string | null;
  servicio: string | null;
  responsable: string | null;
  ubicacion: string | null;
  accesorios: string | null;
  estado: string | null;
  ultimoMtto: string | null;
  instalacion: string | null;
  rule?: Rule;
  warnings: string[];
}

async function readRows(file: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  let headerRow = 0;
  let formatCode = 'INVENTARIO';
  const cols: Record<string, number> = {};
  ws.eachRow((row, n) => {
    const vals = Array.from(row.values as unknown[], (v) => (v === null || v === undefined ? '' : norm(String((v as { text?: string })?.text ?? v))));
    const ci = vals.findIndex((v) => v.startsWith('CODIGO'));
    if (ci >= 0 && !headerRow) formatCode = clean(row.getCell(ci + 1).value) ?? formatCode;
    if (!headerRow && vals.includes('ITEM') && vals.includes('EQUIPO')) {
      headerRow = n;
      vals.forEach((v, i) => v && (cols[v] = i));
    }
  });
  if (!headerRow) throw new Error('No se encontró la fila de encabezados (ITEM, EQUIPO, ...)');
  const need = ['EQUIPO', 'MARCA', 'MODELO', 'SERIE', 'SERVICIO', 'RESPONSABLE', 'UBICACION'];
  for (const k of need) if (cols[k] === undefined) throw new Error(`Falta la columna ${k}`);
  const get = (row: ExcelJS.Row, k: string) => (cols[k] === undefined ? null : clean(row.getCell(cols[k]).value));
  const rows: Row[] = [];
  ws.eachRow((row, n) => {
    if (n <= headerRow) return;
    const equipo = get(row, 'EQUIPO');
    if (!equipo) return;
    const mttoCell = cols['FECHA ULTIMO MTTO'] !== undefined ? row.getCell(cols['FECHA ULTIMO MTTO']).value : null;
    const instCell = cols['FECHA INSTALACION'] !== undefined ? row.getCell(cols['FECHA INSTALACION']).value : null;
    rows.push({
      rowNo: n, item: get(row, 'ITEM'), mc: get(row, 'ACTIVO FIJO'), equipo, marca: get(row, 'MARCA'), modelo: get(row, 'MODELO'),
      serie: get(row, 'SERIE'), servicio: get(row, 'SERVICIO'), responsable: get(row, 'RESPONSABLE'), ubicacion: get(row, 'UBICACION'),
      accesorios: get(row, 'ACCESORIOS'), estado: get(row, 'ESTADO'),
      ultimoMtto: mttoCell instanceof Date ? mttoCell.toISOString().slice(0, 10) : clean(mttoCell),
      instalacion: instCell instanceof Date ? instCell.toISOString().slice(0, 10) : null, warnings: [],
    });
  });
  return { rows, formatCode };
}

function classify(rows: Row[]) {
  for (const r of rows) r.rule = RULES.find(([re]) => re.test(norm(r.equipo)))?.[1];
  const included = rows.filter((r) => r.rule);
  const excluded = rows.filter((r) => !r.rule);
  // Calidad de datos
  const bySerial = new Map<string, Row[]>();
  for (const r of included) if (r.serie) bySerial.set(norm(r.serie), [...(bySerial.get(norm(r.serie)) ?? []), r]);
  for (const [s, list] of bySerial) {
    if (list.length > 1) for (const r of list) r.warnings.push(`Serie ${s} repetida en filas ${list.map((x) => x.rowNo).join(', ')} del archivo: verificar`);
  }
  for (const r of included) {
    if (!r.serie) r.warnings.push('Sin número de serie en el archivo');
    if (r.rule?.sub === 'Router' && /SG108|SWITCH/i.test(`${r.modelo}`)) r.warnings.push(`El modelo ${r.modelo} corresponde a un switch, no a un router: verificar`);
    if (!r.servicio) r.warnings.push('Sin servicio (área) en el archivo');
  }
  return { included, excluded };
}

function report(file: string, formatCode: string, included: Row[], excluded: Row[], dry: boolean, result?: { created: number; skipped: number; areas: number; locations: number }) {
  const count = (list: Row[], key: (r: Row) => string) => [...list.reduce((m, r) => m.set(key(r), (m.get(key(r)) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  let md = `# Informe de importación de inventario\n\n- Archivo: \`${basename(file)}\` (formato ${formatCode})\n- Fecha: ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}\n- Modo: ${dry ? '**SIMULACIÓN (no se escribió en la base de datos)**' : '**IMPORTACIÓN REAL**'}\n\n`;
  md += `## Resumen\n\n| | Filas |\n|---|---|\n| Leídas | ${included.length + excluded.length} |\n| Incluidas (cómputo, sistemas, periféricos, móviles, red/energía TI, aires) | ${included.length} |\n| Excluidas (mobiliario y otros) | ${excluded.length} |\n`;
  if (result) md += `| Activos creados | ${result.created} |\n| Omitidas por ya importadas | ${result.skipped} |\n| Áreas creadas | ${result.areas} |\n| Ubicaciones creadas | ${result.locations} |\n`;
  md += '\n## Incluidos por categoría y tipo\n\n| Categoría | Subcategoría | Cantidad |\n|---|---|---|\n';
  for (const [k, n] of count(included, (r) => `${r.rule!.cat}|${r.rule!.sub}`)) md += `| ${k.split('|')[0]} | ${k.split('|')[1]} | ${n} |\n`;
  md += '\n## Incluidos por servicio\n\n| Servicio | Cantidad |\n|---|---|\n';
  for (const [k, n] of count(included, (r) => r.servicio ?? '(sin servicio)')) md += `| ${k} | ${n} |\n`;
  md += '\n## Excluidos por tipo de elemento\n\n| Elemento | Cantidad |\n|---|---|\n';
  for (const [k, n] of count(excluded, (r) => r.equipo.toUpperCase())) md += `| ${k} | ${n} |\n`;
  const warn = included.filter((r) => r.warnings.length);
  md += `\n## Observaciones de calidad de datos (${warn.length} filas)\n\nSe importan igualmente; quedan anotadas en las observaciones del activo para su revisión.\n\n| Fila | Puesto (MC) | Equipo | Serie | Observación |\n|---|---|---|---|---|\n`;
  for (const r of warn) md += `| ${r.rowNo} | ${r.mc ?? ''} | ${r.equipo} | ${r.serie ?? '—'} | ${r.warnings.join('; ')} |\n`;
  return md;
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) throw new Error('Uso: import-inventory.ts <archivo.xlsx> [--dry-run] [--admin=usuario] [--source=SEDE] [--building=texto] [--report=ruta.md]');
  const dry = args.includes('--dry-run');
  const adminName = args.find((a) => a.startsWith('--admin='))?.split('=')[1] ?? 'admin';
  // Sede de origen: por defecto, la última palabra del nombre del archivo (… MOB CLINICA.xlsx → CLINICA)
  const source = (args.find((a) => a.startsWith('--source='))?.split('=')[1] ?? norm(basename(file).replace(/\.[^.]+$/, '')).split(' ').pop() ?? 'GENERAL').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const building = args.find((a) => a.startsWith('--building='))?.split('=')[1] ?? ({ CLINICA: 'Sede clínica', ADMIN: 'Sede administrativa' } as Record<string, string>)[source] ?? `Sede ${source.toLowerCase()}`;
  const reportPath = args.find((a) => a.startsWith('--report='))?.split('=')[1] ?? `imports/informe-importacion-${source.toLowerCase()}-${dry ? 'simulacion' : 'real'}.md`;

  const { rows, formatCode } = await readRows(file);
  const { included, excluded } = classify(rows);
  const marker = (r: Row) => `[IMPORT ${formatCode} ${source} fila ${r.rowNo}]`;

  // Seriales ya registrados en la base (otras sedes / cargas previas): se advierten, no se bloquean
  const ro = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    const serials = included.filter((r) => r.serie).map((r) => r.serie!);
    const existing = await ro.asset.findMany({ where: { serialNumber: { in: serials } }, select: { code: true, serialNumber: true, notes: true } });
    for (const r of included) {
      const hits = existing.filter((e) => e.serialNumber && norm(e.serialNumber) === norm(r.serie ?? '~') && !e.notes?.includes(marker(r)));
      if (hits.length) r.warnings.push(`Serie ya registrada en el sistema (${hits.map((h) => h.code).join(', ')}): verificar si es el mismo equipo`);
    }
  } finally {
    await ro.$disconnect();
  }

  let result: { created: number; skipped: number; areas: number; locations: number } | undefined;
  if (!dry) {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
    try {
      const admin = await prisma.user.findUnique({ where: { username: adminName } });
      if (!admin) throw new Error(`No existe el usuario "${adminName}" (cree el administrador antes de importar)`);
      result = await prisma.$transaction(async (tx) => {
        const cats = new Map((await tx.assetCategory.findMany({ include: { subcategories: true } })).map((c) => [c.code, c]));
        for (const r of included) if (!cats.has(r.rule!.cat)) throw new Error(`Falta la categoría ${r.rule!.cat}: ejecute la semilla base`);
        let areasCreated = 0;
        let locsCreated = 0;
        const areaId = new Map<string, string>();
        for (const name of [...new Set(included.map((r) => r.servicio ?? 'SIN SERVICIO'))]) {
          const existing = await tx.area.findFirst({ where: { OR: [{ name }, { code: code20(name) }] } });
          if (existing) areaId.set(name, existing.id);
          else {
            areaId.set(name, (await tx.area.create({ data: { code: code20(name), name, description: 'Creada por importación de inventario' } })).id);
            areasCreated++;
          }
        }
        const locId = new Map<string, string>();
        let locSeq = await tx.location.count();
        for (const r of included) {
          if (!r.ubicacion) continue;
          const a = areaId.get(r.servicio ?? 'SIN SERVICIO')!;
          const key = `${a}|${norm(r.ubicacion)}`;
          if (locId.has(key)) continue;
          const existing = await tx.location.findFirst({ where: { areaId: a, name: r.ubicacion } });
          if (existing) locId.set(key, existing.id);
          else {
            locSeq++;
            locId.set(key, (await tx.location.create({ data: { code: `UB-${String(locSeq).padStart(4, '0')}`, name: r.ubicacion, areaId: a, building } })).id);
            locsCreated++;
          }
        }
        let created = 0;
        let skipped = 0;
        for (const r of included) {
          if (await tx.asset.findFirst({ where: { notes: { contains: marker(r) } } })) {
            skipped++;
            continue;
          }
          const cat = cats.get(r.rule!.cat)!;
          const sub = cat.subcategories.find((s) => s.name === r.rule!.sub);
          const rows2 = await tx.$queryRaw<{ value: number }[]>`
            INSERT INTO counters (key, year, value) VALUES (${'ASSET-' + cat.code}, 0, 1)
            ON CONFLICT (key, year) DO UPDATE SET value = counters.value + 1 RETURNING value`;
          const code = `${cat.code}-${String(Number(rows2[0].value)).padStart(4, '0')}`;
          const notes = [
            `Sede de origen: ${building}`,
            r.mc ? `Activo fijo / puesto de origen: ${r.mc}` : null,
            r.item ? `Ítem en inventario de origen: ${r.item}` : null,
            r.accesorios ? `Accesorios: ${r.accesorios}` : null,
            r.estado ? `Observación de origen: ${r.estado}` : null,
            r.ultimoMtto ? `Último mantenimiento (origen): ${r.ultimoMtto}` : null,
            ...r.warnings.map((w) => `⚠ ${w}`),
            marker(r),
          ].filter(Boolean).join('\n');
          const a = await tx.asset.create({
            data: {
              code, name: r.equipo, categoryId: cat.id, subcategoryId: sub?.id ?? null, brand: r.marca, model: r.modelo, serialNumber: r.serie,
              areaId: areaId.get(r.servicio ?? 'SIN SERVICIO')!, locationId: r.ubicacion ? locId.get(`${areaId.get(r.servicio ?? 'SIN SERVICIO')}|${norm(r.ubicacion)}`) : null,
              endUser: r.responsable, criticality: 'MEDIA', status: 'OPERATIVO', notes, createdById: admin.id,
              installationDate: r.instalacion ? new Date(`${r.instalacion}T00:00:00Z`) : null,
            },
          });
          await tx.auditLog.create({
            data: { userId: admin.id, username: admin.username, action: 'IMPORTAR', module: 'inventario', entity: 'Asset', entityId: a.id, after: { code, name: a.name, serialNumber: a.serialNumber, origen: `${basename(file)} fila ${r.rowNo}` }, reason: 'Carga inicial del inventario institucional' },
          });
          created++;
        }
        await tx.auditLog.create({
          data: { userId: admin.id, username: admin.username, action: 'IMPORTACION_INVENTARIO', module: 'inventario', after: { archivo: basename(file), sede: source, creados: created, omitidos: skipped, excluidos: excluded.length, areas: areasCreated, ubicaciones: locsCreated }, reason: 'Carga inicial del inventario institucional' },
        });
        return { created, skipped, areas: areasCreated, locations: locsCreated };
      }, { timeout: 300_000, maxWait: 20_000 });
    } finally {
      await prisma.$disconnect();
    }
  }
  mkdirSync(reportPath.replace(/[\\/][^\\/]+$/, '') || '.', { recursive: true });
  writeFileSync(reportPath, report(`${file}`, `${formatCode} · sede ${source}`, included, excluded, dry, result));
  console.log(`Filas leídas: ${rows.length} · incluidas: ${included.length} · excluidas: ${excluded.length}${result ? ` · creadas: ${result.created} · omitidas: ${result.skipped}` : ''}`);
  console.log(`Informe: ${reportPath}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
