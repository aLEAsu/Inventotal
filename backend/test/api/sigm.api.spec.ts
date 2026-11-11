/**
 * Pruebas de integración contra PostgreSQL real (base efímera por ejecución).
 * Recorren el flujo completo del sistema y los escenarios obligatorios de calidad.
 */
import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { HttpStatus } from '@nestjs/common';
import { Prisma } from '../../src/generated/prisma/client';
import { AllExceptionsFilter } from '../../src/common/errors.filter';
import { currentYearBogota, todayBogota } from '../../src/common/dates';
import type { PrismaService } from '../../src/common/prisma.service';
import { binaryParser, bootApp, Client, createUsers } from './helpers';

jest.setTimeout(120_000);

let app: INestApplication;
let prisma: PrismaService;
let ctx: Awaited<ReturnType<typeof createUsers>>;
const YEAR = currentYearBogota();
const c: Record<string, Client> = {};
const ids: Record<string, string> = {};

beforeAll(async () => {
  ({ app, prisma } = await bootApp());
  ctx = await createUsers(prisma);
  for (const [k, u] of Object.entries({ admin: 't.admin', coord: 't.coord', coord2: 't.coord2', resp: 't.resp', tech: 't.tecnico', req: 't.solicitante', auditor: 't.auditor' })) {
    c[k] = new Client(app);
    const r = await c[k].login(u);
    expect(r.status).toBe(200);
  }
});

afterAll(async () => {
  await app?.close();
});

// --------------------------------------------------------------------------- 1. Autenticación
describe('1. Inicio de sesión', () => {
  it('rechaza credenciales inválidas sin revelar si el usuario existe', async () => {
    const a = await new Client(app).login('t.coord', 'Clave-Incorrecta-1');
    const b = await new Client(app).login('no.existe', 'Clave-Incorrecta-1');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.message).toBe(b.body.message);
  });

  it('emite cookie HttpOnly SameSite=Strict y no expone el token en el cuerpo', async () => {
    const cl = new Client(app);
    const r = await cl.login('t.auditor');
    const cookie = (r.headers['set-cookie'] as unknown as string[]).find((x) => x.startsWith('sigm_session='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(JSON.stringify(r.body)).not.toContain(cookie.split(';')[0].split('=')[1]);
  });

  it('bloquea la cuenta tras intentos fallidos consecutivos', async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: 'SOLICITANTE' } });
    await prisma.user.create({ data: { username: 't.lock', fullName: 'Bloqueo', roleId: role.id, passwordHash: (await prisma.user.findUniqueOrThrow({ where: { username: 't.solicitante' } })).passwordHash } });
    for (let i = 0; i < 5; i++) await new Client(app).login('t.lock', 'Mala-Clave-123!');
    const u = await prisma.user.findUniqueOrThrow({ where: { username: 't.lock' } });
    expect(u.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    const ok = await new Client(app).login('t.lock'); // contraseña correcta, pero bloqueada
    expect(ok.status).toBe(401);
    expect(ok.body.message).toMatch(/bloqueada/);
  });

  it('exige CSRF en operaciones de escritura y cierra sesión correctamente', async () => {
    const cl = new Client(app);
    await cl.login('t.auditor');
    const noCsrf = await cl.agent.post('/api/v1/auth/logout');
    expect(noCsrf.status).toBe(403);
    expect((await cl.post('/auth/logout')).status).toBe(200);
    expect((await cl.get('/auth/me')).status).toBe(401);
  });

  it('obliga a cambiar la contraseña temporal y aplica la política', async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: 'AUDITOR' } });
    const r = await c.admin.post('/users', { username: 't.nuevo', fullName: 'Nuevo Usuario', roleId: role.id, password: 'Temporal-2026-Ab' });
    expect(r.status).toBe(201);
    const cl = new Client(app);
    await cl.login('t.nuevo', 'Temporal-2026-Ab');
    expect((await cl.get('/assets')).status).toBe(403);
    expect((await cl.post('/auth/change-password', { currentPassword: 'Temporal-2026-Ab', newPassword: 'corta' })).status).toBe(400);
    expect((await cl.post('/auth/change-password', { currentPassword: 'Temporal-2026-Ab', newPassword: 'Definitiva-2026-Xy' })).status).toBe(200);
    expect((await cl.get('/assets')).status).toBe(200);
  });
});

// --------------------------------------------------------------------------- 3. Inventario
describe('3. Registro de activos (todas las categorías de TI)', () => {
  it('registra un activo en cada categoría configurada', async () => {
    const cats = (await c.coord.get('/categories')).body as { id: string; code: string; name: string }[];
    expect(cats.length).toBeGreaterThanOrEqual(7);
    for (const cat of cats) {
      const r = await c.coord.post('/assets', {
        name: `Equipo ${cat.name}`, categoryId: cat.id, areaId: ctx.areas.uci.id, criticality: cat.code === 'SRV' ? 'CRITICA' : 'MEDIA',
        brand: 'Marca', model: 'M1', serialNumber: `SN-${cat.code}`, hostname: `HOST-${cat.code}`, ipAddress: '10.1.1.' + (cats.indexOf(cat) + 10),
        operatingSystem: 'SO prueba', ramGb: 16, storageGb: 512, endUser: 'Puesto de prueba', acquisitionDate: `${YEAR - 1}-01-10`,
      });
      expect(r.status).toBe(201);
      expect(r.body.code).toMatch(new RegExp(`^${cat.code}-\\d{4}$`));
      ids[`asset_${cat.code}`] = r.body.id;
    }
    const list = await c.coord.get('/assets?q=HOST-SRV');
    expect(list.body.total).toBe(1);
  });

  it('valida datos técnicos y unicidad del código', async () => {
    const cats = (await c.coord.get('/categories')).body as { id: string }[];
    expect((await c.coord.post('/assets', { name: 'X', categoryId: cats[0].id, areaId: ctx.areas.uci.id, ipAddress: '999.1.1.1' })).status).toBe(400);
    expect((await c.coord.post('/assets', { name: 'X', categoryId: cats[0].id, areaId: ctx.areas.uci.id, macAddress: 'zz' })).status).toBe(400);
    const a = await c.coord.post('/assets', { code: 'DUP-001', name: 'Dup', categoryId: cats[0].id, areaId: ctx.areas.uci.id });
    expect(a.status).toBe(201);
    const b = await c.coord.post('/assets', { code: 'DUP-001', name: 'Dup 2', categoryId: cats[0].id, areaId: ctx.areas.uci.id });
    expect(b.status).toBe(409);
    ids.dupAsset = a.body.id;
  });

  it('evalúa la criticidad con la matriz configurable y conserva el historial', async () => {
    const criteria = (await c.coord.get('/criticality/criteria')).body as { code: string }[];
    const scores = Object.fromEntries(criteria.map((x) => [x.code, 5]));
    const r = await c.coord.post(`/assets/${ids.asset_CMP}/criticality`, { scores, justification: 'Equipo de uso asistencial sin respaldo' });
    expect(r.status).toBe(201);
    expect(r.body.computedLevel).toBe('CRITICA');
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: ids.asset_CMP } })).criticality).toBe('CRITICA');
  });

  it('genera el código QR del activo', async () => {
    const r = await c.coord.get(`/assets/${ids.asset_CMP}/qr`).buffer(true).parse(binaryParser as never);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect((r.body as Buffer).subarray(1, 4).toString()).toBe('PNG');
  });
});

// --------------------------------------------------------------------------- 2. Control de acceso
describe('2. Control de acceso por rol (aplicado en el backend)', () => {
  it('solicitante: solo reporta fallas', async () => {
    expect((await c.req.get('/assets')).status).toBe(403);
    expect((await c.req.get('/plans')).status).toBe(403);
    expect((await c.req.get('/audit')).status).toBe(403);
    expect((await c.req.get('/assets/options')).status).toBe(200);
  });
  it('auditor: lectura sin escritura', async () => {
    expect((await c.auditor.get('/audit')).status).toBe(200);
    expect((await c.auditor.get('/assets')).status).toBe(200);
    const cats = (await c.auditor.get('/categories')).body as { id: string }[];
    expect((await c.auditor.post('/assets', { name: 'X', categoryId: cats[0].id, areaId: ctx.areas.uci.id })).status).toBe(403);
    expect((await c.auditor.post(`/plans/${YEAR}`)).status).toBe(403);
  });
  it('técnico: no administra usuarios ni planes', async () => {
    expect((await c.tech.get('/users')).status).toBe(403);
    expect((await c.tech.post(`/plans/${YEAR}/generate`)).status).toBe(403);
  });
  it('responsable de área: solo ve activos de su área', async () => {
    const cats = (await c.coord.get('/categories')).body as { id: string }[];
    const other = await c.coord.post('/assets', { name: 'Equipo urgencias', categoryId: cats[0].id, areaId: ctx.areas.urg.id });
    ids.urgAsset = other.body.id;
    const list = await c.resp.get('/assets?pageSize=500');
    expect(list.status).toBe(200);
    expect((list.body.items as { areaId: string }[]).every((a) => a.areaId === ctx.areas.uci.id)).toBe(true);
    expect((await c.resp.get(`/assets/${ids.urgAsset}`)).status).toBe(403);
    expect((await c.resp.post('/assets', { name: 'X', categoryId: cats[0].id, areaId: ctx.areas.urg.id })).status).toBe(403);
  });
  it('coordinador: no administra usuarios; administrador sí', async () => {
    expect((await c.coord.get('/settings')).status).toBe(403);
    expect((await c.admin.get('/settings')).status).toBe(200);
    expect((await c.admin.get('/roles')).status).toBe(200);
  });
});

// --------------------------------------------------------------------------- 4–6. Programas y cronograma
describe('4-6. Programas preventivos y generación del cronograma', () => {
  it('exige sustento técnico de la periodicidad', async () => {
    const r = await c.coord.post('/programs', { assetId: ids.asset_CMP, name: 'Preventivo', frequencyType: 'MENSUAL', startDate: `${YEAR - 1}-01-01`, baseDate: `${YEAR - 1}-01-15`, frequencyJustification: '' });
    expect(r.status).toBe(400);
  });

  it('crea programas con distintas periodicidades', async () => {
    const mk = (assetId: string, frequencyType: string, extra: object = {}) =>
      c.coord.post('/programs', {
        assetId, name: `Preventivo ${frequencyType}`, frequencyType, startDate: `${YEAR - 1}-01-01`, baseDate: `${YEAR - 1}-01-15`,
        frequencyJustification: 'Recomendación del fabricante y condiciones de uso', responsibleId: ctx.users.tech.id,
        checklist: [{ id: 'a', text: 'Limpieza física', required: true }, { id: 'b', text: 'Actualizaciones', required: true }, { id: 'c', text: 'Etiqueta', required: false }], ...extra,
      });
    const results = await Promise.all([
      mk(ids.asset_CMP, 'MENSUAL'),
      mk(ids.asset_SRV, 'TRIMESTRAL'),
      mk(ids.asset_RED, 'SEMESTRAL'),
      mk(ids.asset_PER, 'ANUAL'),
      mk(ids.asset_TEL, 'PERSONALIZADO', { intervalValue: 10, intervalUnit: 'SEMANAS' }),
      mk(ids.asset_SIS, 'FECHAS_ESPECIFICAS', { specificDates: ['03-15', '09-15'] }),
    ]);
    results.forEach((r) => expect(r.status).toBe(201));
    ids.progMonthly = results[0].body.id;
    ids.progQuarterly = results[1].body.id;
    const prev = await c.coord.get(`/programs/${ids.progQuarterly}/preview/${YEAR}`);
    expect(prev.body.dates).toEqual([`${YEAR}-01-15`, `${YEAR}-04-15`, `${YEAR}-07-15`, `${YEAR}-10-15`]);
  });

  it('el año actual se obtiene del servidor en America/Bogota', async () => {
    const r = await c.coord.get('/plans/current-year');
    expect(r.body).toMatchObject({ year: YEAR, today: todayBogota(), timezone: 'America/Bogota' });
  });

  it('crea el plan del año actual y no permite duplicarlo', async () => {
    expect((await c.coord.post(`/plans/${YEAR}`, {})).status).toBe(201);
    expect((await c.coord.post(`/plans/${YEAR}`, {})).status).toBe(409);
  });

  it('genera el cronograma de forma transaccional con resumen por categoría y mes', async () => {
    const r = await c.coord.post(`/plans/${YEAR}/generate`, {});
    expect(r.status).toBe(201);
    // mensual 12 + trimestral 4 + semestral 2 + anual 1 + fechas 2 + cada 10 semanas (≥5)
    expect(r.body.created).toBeGreaterThanOrEqual(26);
    expect(r.body.byMonth.reduce((s: number, x: number) => s + x, 0)).toBe(r.body.created);
    expect(Object.keys(r.body.byCategory).length).toBe(6);
    ids.generated = String(r.body.created);
  });

  it('6. la generación repetida es idempotente (no duplica)', async () => {
    const before = await prisma.scheduledActivity.count();
    const [a, b] = await Promise.all([c.coord.post(`/plans/${YEAR}/generate`, {}), c.coord.post(`/plans/${YEAR}/generate`, {})]);
    expect(a.body.created + b.body.created).toBe(0);
    expect(await prisma.scheduledActivity.count()).toBe(before);
  });

  it('activos nuevos se incorporan al regenerar; activos dados de baja dejan de generar fechas futuras', async () => {
    const cats = (await c.coord.get('/categories')).body as { id: string }[];
    const nuevo = await c.coord.post('/assets', { name: 'Equipo nuevo', categoryId: cats[0].id, areaId: ctx.areas.uci.id });
    await c.coord.post('/programs', { assetId: nuevo.body.id, name: 'Preventivo nuevo', frequencyType: 'SEMESTRAL', startDate: `${YEAR}-01-01`, baseDate: `${YEAR}-02-01`, frequencyJustification: 'Recomendación del fabricante' });
    const g = await c.coord.post(`/plans/${YEAR}/generate`, {});
    expect(g.body.created).toBe(2);
    // baja
    const baja = await c.coord.post(`/assets/${nuevo.body.id}/status`, { status: 'DADO_DE_BAJA', reason: 'Obsolescencia tecnológica', effectiveDate: `${YEAR}-01-02` });
    expect(baja.status).toBe(201);
    const acts = await prisma.scheduledActivity.findMany({ where: { assetId: nuevo.body.id } });
    expect(acts).toHaveLength(2); // se conservan
    expect(acts.every((a) => a.status === 'NO_APLICA')).toBe(true);
    expect((await c.coord.post(`/plans/${YEAR}/generate`, {})).body.created).toBe(0);
    // un activo con historial no se elimina físicamente
    expect((await c.coord.delete(`/assets/${nuevo.body.id}`)).status).toBe(409);
    // un activo sin historial sí
    expect((await c.coord.delete(`/assets/${ids.dupAsset}`)).status).toBe(200);
  });

  it('cambio de periodicidad en borrador: excluye fechas obsoletas sin borrarlas', async () => {
    const before = await prisma.scheduledActivity.count({ where: { programId: ids.progQuarterly } });
    const r = await c.coord.patch(`/programs/${ids.progQuarterly}`, { frequencyType: 'SEMESTRAL', changeReason: 'Ajuste por historial de fallas' });
    expect(r.status).toBe(200);
    const g = await c.coord.post(`/plans/${YEAR}/generate`, {});
    expect(g.body.excluded).toBe(2); // 04-15 y 10-15 dejan de aplicar
    expect(await prisma.scheduledActivity.count({ where: { programId: ids.progQuarterly } })).toBe(before);
    // revertir: las fechas excluidas se reactivan
    await c.coord.patch(`/programs/${ids.progQuarterly}`, { frequencyType: 'TRIMESTRAL', changeReason: 'Se revierte el ajuste' });
    expect((await c.coord.post(`/plans/${YEAR}/generate`, {})).body.reactivated).toBe(2);
  });

  it('vista matricial (12 meses) y detalle con filtros', async () => {
    const m = await c.coord.get(`/plans/${YEAR}/matrix`);
    expect(m.status).toBe(200);
    const row = (m.body.rows as { programId: string; months: unknown[][] }[]).find((r) => r.programId === ids.progMonthly)!;
    expect(row.months).toHaveLength(12);
    expect(row.months.every((x) => x.length === 1)).toBe(true);
    const d = await c.coord.get(`/plans/${YEAR}/activities?month=3&pageSize=500`);
    expect((d.body.items as { committedDate: string }[]).every((a) => a.committedDate.slice(5, 7) === '03')).toBe(true);
    const v = await c.coord.get(`/plans/${YEAR}/activities?status=VENCIDO&pageSize=500`);
    expect((v.body.items as { committedDate: string; displayStatus: string }[]).every((a) => a.committedDate < todayBogota() && a.displayStatus === 'VENCIDO')).toBe(true);
  });
});

// --------------------------------------------------------------------------- 7–9. Exportaciones
describe('7-9. Impresión, PDF y Excel del cronograma', () => {
  it('8. descarga un PDF real con encabezado institucional y varias páginas', async () => {
    const r = await c.coord.get(`/plans/${YEAR}/export.pdf`).buffer(true).parse(binaryParser as never);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    const buf = r.body as Buffer;
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    const pages = (buf.toString('latin1').match(/\/Type \/Page[^s]/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(2);
    const a3 = await c.coord.get(`/plans/${YEAR}/export.pdf?paper=a3&month=3`).buffer(true).parse(binaryParser as never);
    expect(a3.status).toBe(200);
  });

  it('8b. PDF con tabla extensa (500+ actividades) se genera paginado', async () => {
    const asset = ids.asset_UPS;
    await c.coord.post('/programs', { assetId: asset, name: 'Inspección semanal extensa', frequencyType: 'PERSONALIZADO', intervalValue: 1, intervalUnit: 'DIAS', startDate: `${YEAR}-01-01`, baseDate: `${YEAR}-01-01`, frequencyJustification: 'Prueba de volumen del reporte' });
    const g = await c.coord.post(`/plans/${YEAR}/generate`, {});
    expect(g.body.created).toBeGreaterThanOrEqual(365);
    const r = await c.coord.get(`/plans/${YEAR}/export.pdf`).buffer(true).parse(binaryParser as never);
    expect(r.status).toBe(200);
    const pages = ((r.body as Buffer).toString('latin1').match(/\/Type \/Page[^s]/g) ?? []).length;
    expect(pages).toBeGreaterThan(8);
  });

  it('9. exporta Excel con las tres hojas obligatorias, filtros y fechas', async () => {
    const r = await c.coord.get(`/plans/${YEAR}/export.xlsx`).buffer(true).parse(binaryParser as never);
    expect(r.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.body as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Resumen anual', 'Cronograma mensual', 'Detalle de actividades']);
    const det = wb.getWorksheet('Detalle de actividades')!;
    expect(det.autoFilter).toBeTruthy();
    expect(det.getRow(6).getCell(1).numFmt).toBe('dd/mm/yyyy');
    const total = await prisma.scheduledActivity.count();
    expect(det.rowCount).toBeGreaterThanOrEqual(total + 5);
  });

  it('7. la vista de impresión consume datos persistidos (resumen y totales por categoría)', async () => {
    const s = await c.coord.get(`/plans/${YEAR}/summary`);
    expect(s.body.total).toBe(await prisma.scheduledActivity.count({ where: { plan: { year: YEAR } } }));
    expect(Object.keys(s.body.byCategory).length).toBeGreaterThan(0);
  });
});

// --------------------------------------------------------------------------- Control documental y reprogramación
describe('Control documental del plan y 15. reprogramación con trazabilidad', () => {
  it('flujo borrador → revisión → aprobado con versión inmutable', async () => {
    expect((await c.tech.post(`/plans/${YEAR}/approve`)).status).toBe(403);
    expect((await c.coord.post(`/plans/${YEAR}/approve`)).status).toBe(409); // aún en borrador
    expect((await c.coord.post(`/plans/${YEAR}/submit`)).status).toBe(201);
    expect((await c.coord.post(`/plans/${YEAR}/generate`, {})).status).toBe(409); // en revisión
    expect((await c.coord.post(`/plans/${YEAR}/approve`, { reason: 'Revisado y aprobado' })).status).toBe(201);
    const p = (await c.coord.get(`/plans/${YEAR}`)).body.plan;
    expect(p.status).toBe('APROBADO');
    expect(p.approvedBy).toBeTruthy();
    expect(await prisma.annualPlanVersion.count({ where: { planId: p.id } })).toBe(1);
  });

  it('la fecha originalmente aprobada no se puede modificar ni siquiera por SQL directo', async () => {
    const a = await prisma.scheduledActivity.findFirstOrThrow({ where: { programId: ids.progMonthly } });
    await expect(prisma.scheduledActivity.update({ where: { id: a.id }, data: { originalDate: new Date(`${YEAR}-12-31T00:00:00Z`) } })).rejects.toThrow(/originalmente aprobada/);
  });

  it('reprogramación: exige motivo, queda pendiente, conserva la fecha original e incrementa la versión', async () => {
    const acts = await prisma.scheduledActivity.findMany({ where: { programId: ids.progMonthly }, orderBy: { originalDate: 'asc' } });
    const target = acts[acts.length - 1]; // diciembre
    ids.reschedAct = target.id;
    const toDate = `${YEAR}-12-28`;
    expect((await c.resp.post(`/activities/${target.id}/reschedule`, { toDate, reason: 'corto' })).status).toBe(400);
    const req = await c.resp.post(`/activities/${target.id}/reschedule`, { toDate, reason: 'Equipo en uso continuo por contingencia del servicio' });
    expect(req.status).toBe(201);
    expect(req.body.applied).toBe(false);
    expect((await c.resp.post(`/reschedules/${req.body.id}/decide`, { approve: true })).status).toBe(403);
    const dec = await c.coord.post(`/reschedules/${req.body.id}/decide`, { approve: true, note: 'Aprobado' });
    expect(dec.status).toBe(201);
    const after = await prisma.scheduledActivity.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.originalDate.toISOString().slice(0, 10)).toBe(target.originalDate.toISOString().slice(0, 10));
    expect(after.committedDate.toISOString().slice(0, 10)).toBe(toDate);
    expect(after.status).toBe('REPROGRAMADO');
    const plan = (await c.coord.get(`/plans/${YEAR}`)).body.plan;
    expect(plan.version).toBe(2);
    const h = await c.coord.get(`/plans/${YEAR}/history`);
    expect(h.body.reschedules[0]).toMatchObject({ toDate, status: 'APROBADA' });
    expect(h.body.versions).toHaveLength(2);
  });

  it('en plan aprobado, la regeneración solo agrega programas nuevos y exige justificación', async () => {
    const cats = (await c.coord.get('/categories')).body as { id: string }[];
    const a = await c.coord.post('/assets', { name: 'Equipo agregado tras aprobación', categoryId: cats[1].id, areaId: ctx.areas.uci.id });
    await c.coord.post('/programs', { assetId: a.body.id, name: 'Preventivo agregado', frequencyType: 'ANUAL', startDate: `${YEAR}-01-01`, baseDate: `${YEAR}-12-01`, frequencyJustification: 'Recomendación del fabricante' });
    expect((await c.coord.post(`/plans/${YEAR}/generate`, {})).status).toBe(400);
    const g = await c.coord.post(`/plans/${YEAR}/generate`, { reason: 'Inclusión de equipo adquirido en el año' });
    expect(g.body.created).toBe(1);
    const added = await prisma.scheduledActivity.findFirstOrThrow({ where: { assetId: a.body.id } });
    expect(added.addedAfterApproval).toBe(true);
    // el cambio de periodicidad de un programa ya aprobado no altera el plan aprobado
    const n = await prisma.scheduledActivity.count({ where: { programId: ids.progMonthly, status: { not: 'NO_APLICA' } } });
    await c.coord.patch(`/programs/${ids.progMonthly}`, { frequencyType: 'TRIMESTRAL', changeReason: 'Cambio para el próximo año' });
    await c.coord.post(`/plans/${YEAR}/generate`, { reason: 'Verificación de no alteración' });
    expect(await prisma.scheduledActivity.count({ where: { programId: ids.progMonthly, status: { not: 'NO_APLICA' } } })).toBe(n);
    await c.coord.patch(`/programs/${ids.progMonthly}`, { frequencyType: 'MENSUAL', changeReason: 'Se restablece' });
  });
});

// --------------------------------------------------------------------------- 10, 12, 13. Órdenes preventivas
describe('10-13. Órdenes preventivas, evidencias y cierre', () => {
  it('genera la orden desde la actividad sin marcarla ejecutada', async () => {
    const act = await prisma.scheduledActivity.findFirstOrThrow({ where: { programId: ids.progMonthly, status: 'PROGRAMADO' }, orderBy: { originalDate: 'asc' } });
    ids.prevAct = act.id;
    const r = await c.coord.post(`/workorders/from-activity/${act.id}`, {});
    expect(r.status).toBe(201);
    expect(r.body.code).toMatch(new RegExp(`^OT-${YEAR}-\\d{5}$`));
    expect(r.body.status).toBe('ASIGNADA'); // responsable del programa
    ids.prevWo = r.body.id;
    expect((await prisma.scheduledActivity.findUniqueOrThrow({ where: { id: act.id } })).status).toBe('PROGRAMADO');
    expect((await c.coord.post(`/workorders/from-activity/${act.id}`, {})).status).toBe(409);
  });

  it('solo el responsable asignado (o la coordinación) ejecuta; no se puede cerrar sin campos obligatorios', async () => {
    const other = new Client(app);
    await prisma.user.create({ data: { username: 't.tec2', fullName: 'Otro técnico', roleId: (await prisma.role.findUniqueOrThrow({ where: { code: 'TECNICO' } })).id, passwordHash: (await prisma.user.findUniqueOrThrow({ where: { username: 't.tecnico' } })).passwordHash } });
    await other.login('t.tec2');
    expect((await other.post(`/workorders/${ids.prevWo}/start`)).status).toBe(403);
    expect((await c.tech.post(`/workorders/${ids.prevWo}/start`)).status).toBe(201);
    expect((await prisma.scheduledActivity.findUniqueOrThrow({ where: { id: ids.prevAct } })).status).toBe('EN_EJECUCION');
    const sub = await c.tech.post(`/workorders/${ids.prevWo}/submit`);
    expect(sub.status).toBe(400);
    expect(sub.body.missing.join(' ')).toMatch(/Actividades ejecutadas/);
  });

  it('pausa con justificación, registra ejecución, repuestos y costos', async () => {
    expect((await c.tech.post(`/workorders/${ids.prevWo}/pause`, { status: 'PENDIENTE_REPUESTOS', reason: 'x' })).status).toBe(400);
    expect((await c.tech.post(`/workorders/${ids.prevWo}/pause`, { status: 'PENDIENTE_REPUESTOS', reason: 'Se espera disco de reemplazo' })).status).toBe(201);
    expect((await c.tech.post(`/workorders/${ids.prevWo}/resume`)).status).toBe(201);
    const wo = (await c.tech.get(`/workorders/${ids.prevWo}`)).body;
    const ex = await c.tech.patch(`/workorders/${ids.prevWo}/execution`, {
      activitiesPerformed: 'Limpieza física, actualización de sistema operativo y antivirus',
      checklistResults: (wo.checklistResults as { itemId: string }[]).map((i) => ({ itemId: i.itemId, result: 'CUMPLE' })),
      result: 'Equipo funcionando correctamente', finalCondition: 'OPERATIVO', laborCost: 80000,
    });
    expect(ex.status).toBe(200);
    const p = await c.tech.post(`/workorders/${ids.prevWo}/parts`, { name: 'Disco SSD 512 GB', quantity: 1, unitCost: 250000 });
    expect(p.status).toBe(201);
    const after = await prisma.workOrder.findUniqueOrThrow({ where: { id: ids.prevWo } });
    expect(Number(after.totalCost)).toBe(330000);
  });

  it('13. adjunta evidencias validando tipo real y rechaza archivos disfrazados', async () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    const ok = await c.tech.upload('/documents', { type: 'INFORME_MANTENIMIENTO', title: 'Informe técnico', workOrderId: ids.prevWo }, pdf, 'informe.pdf', 'application/pdf');
    expect(ok.status).toBe(201);
    expect(ok.body.storedName).toBeUndefined();
    ids.doc = ok.body.id;
    const fake = await c.tech.upload('/documents', { type: 'FOTOGRAFIA', title: 'Foto', workOrderId: ids.prevWo }, Buffer.from('<script>alert(1)</script>'), 'foto.png', 'image/png');
    expect(fake.status).toBe(400);
    const exe = await c.tech.upload('/documents', { type: 'OTRO', title: 'Ejecutable', workOrderId: ids.prevWo }, Buffer.from('MZ\x90\x00'), 'x.exe', 'application/octet-stream');
    expect(exe.status).toBe(400);
    const dl = await c.tech.get(`/documents/${ids.doc}/download`).buffer(true).parse(binaryParser as never);
    expect(dl.status).toBe(200);
    expect((dl.body as Buffer).equals(pdf)).toBe(true);
    expect((await c.req.get(`/documents/${ids.doc}/download`)).status).toBe(403);
  });

  it('12. validación: segregación de funciones y cierre que marca la actividad como ejecutada', async () => {
    expect((await c.tech.post(`/workorders/${ids.prevWo}/submit`)).status).toBe(201);
    // el coordinador asignado no puede validar su propia orden: aquí ejecutó el técnico, valida el coordinador
    const bad = await c.coord.post(`/workorders/${ids.prevWo}/close`, { verificationNote: 'ok', validatorSignature: 'x' });
    expect(bad.status).toBe(400);
    const close = await c.coord.post(`/workorders/${ids.prevWo}/close`, { verificationNote: 'Verificado en sitio con el usuario', validatorSignature: 'Coordinador de sistemas - CC 123' });
    expect(close.status).toBe(201);
    const act = await prisma.scheduledActivity.findUniqueOrThrow({ where: { id: ids.prevAct } });
    expect(act.status).toBe('EJECUTADO');
    expect(act.executedDate!.toISOString().slice(0, 10)).toBe(todayBogota());
    expect(act.originalDate.toISOString().slice(0, 10)).toBe(act.periodKey); // fecha original intacta
    expect((await c.coord.post(`/workorders/${ids.prevWo}/cancel`, { reason: 'Intento de cancelar cerrada' })).status).toBe(409);
  });

  it('las órdenes no pueden eliminarse (regla de integridad en BD)', async () => {
    const err = await prisma.workOrder.delete({ where: { id: ids.prevWo } }).catch((e: Error) => e);
    expect(JSON.stringify((err as { meta?: unknown }).meta)).toMatch(/No se permite eliminar registros de work_orders/);
  });

  it('cancelación exige justificación y conserva el registro', async () => {
    const act = await prisma.scheduledActivity.findFirstOrThrow({ where: { programId: ids.progMonthly, status: 'PROGRAMADO' }, orderBy: { originalDate: 'desc' } });
    const wo = await c.coord.post(`/workorders/from-activity/${act.id}`, {});
    expect((await c.coord.post(`/workorders/${wo.body.id}/cancel`, { reason: 'no' })).status).toBe(400);
    expect((await c.coord.post(`/workorders/${wo.body.id}/cancel`, { reason: 'Equipo trasladado temporalmente a otra sede' })).status).toBe(201);
    const w = await prisma.workOrder.findUniqueOrThrow({ where: { id: wo.body.id } });
    expect(w.status).toBe('CANCELADA');
    expect(await prisma.workOrderEvent.count({ where: { workOrderId: w.id, action: 'CANCELAR' } })).toBe(1);
    // la actividad puede recibir una nueva orden
    expect((await c.coord.post(`/workorders/from-activity/${act.id}`, {})).status).toBe(201);
  });
});

// --------------------------------------------------------------------------- 11. Correctivos
describe('11. Solicitudes correctivas y atención de fallas', () => {
  it('el solicitante reporta una falla con consecutivo único y prioridad calculada', async () => {
    const r = await c.req.post('/failures', {
      assetId: ids.asset_SRV, title: 'Servidor no responde', description: 'El sistema clínico no carga desde las 7 am',
      assetCondition: 'NO_FUNCIONA', safety: 5, care: 5, continuity: 5,
    });
    expect(r.status).toBe(201);
    expect(r.body.code).toMatch(new RegExp(`^FA-${YEAR}-\\d{5}$`));
    expect(r.body.priority).toBe('URGENTE');
    expect(r.body.downtimeStart).toBeTruthy();
    ids.failure = r.body.id;
    const list = await c.req.get('/failures');
    expect(list.body.items.every((f: { reporterId: string }) => f.reporterId === ctx.users.req.id)).toBe(true);
    const dash = await c.coord.get(`/dashboard?year=${YEAR}`);
    expect(dash.body.general.urgentCorrective).toBe(1);
    expect(dash.body.urgentFailures[0].id).toBe(ids.failure);
  });

  it('evaluación con cambio de prioridad justificado y marcación fuera de servicio', async () => {
    expect((await c.coord.post(`/failures/${ids.failure}/evaluate`, { priority: 'ALTA' })).status).toBe(400);
    const e = await c.coord.post(`/failures/${ids.failure}/evaluate`, { markOutOfService: true, note: 'Se activa contingencia manual' });
    expect(e.status).toBe(201);
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: ids.asset_SRV } })).status).toBe('FUERA_DE_SERVICIO');
  });

  it('asignación genera la orden correctiva vinculada', async () => {
    const a = await c.coord.post(`/failures/${ids.failure}/assign`, { assignedToId: ctx.users.tech.id });
    expect(a.status).toBe(201);
    ids.corrWo = a.body.workOrder.id;
    const wo = await prisma.workOrder.findUniqueOrThrow({ where: { id: ids.corrWo } });
    expect(wo).toMatchObject({ type: 'CORRECTIVA', failureReportId: ids.failure, status: 'ASIGNADA' });
  });

  it('un activo crítico solo lo libera personal con competencia técnica', async () => {
    await c.tech.post(`/workorders/${ids.corrWo}/start`);
    await c.tech.patch(`/workorders/${ids.corrWo}/execution`, {
      diagnosis: 'Fuente de poder averiada en el nodo principal', activitiesPerformed: 'Reemplazo de fuente de poder y verificación de servicios',
      testsPerformed: 'Arranque y pruebas de servicio', finalCondition: 'OPERATIVO', externalCost: 1200000,
    });
    expect((await c.tech.post(`/workorders/${ids.corrWo}/submit`)).status).toBe(201);
    const denied = await c.coord2.post(`/workorders/${ids.corrWo}/close`, { verificationNote: 'Servicio restablecido y verificado', validatorSignature: 'Coordinador 2' });
    expect(denied.status).toBe(403);
    expect(denied.body.message).toMatch(/CRÍTICO/);
    const ok = await c.coord.post(`/workorders/${ids.corrWo}/close`, { verificationNote: 'Servicio restablecido y verificado', validatorSignature: 'Coordinador de sistemas - CC 123' });
    expect(ok.status).toBe(201);
    const f = await prisma.failureReport.findUniqueOrThrow({ where: { id: ids.failure } });
    expect(f.status).toBe('RESUELTA');
    expect(f.resolvedByWorkOrderId).toBe(ids.corrWo);
    expect(f.releaseAuthorizedById).toBe(ctx.users.coord.id);
    expect(f.downtimeEnd).toBeTruthy();
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: ids.asset_SRV } })).status).toBe('OPERATIVO');
    // el correctivo NO marca como cumplida ninguna actividad preventiva
    expect(await prisma.scheduledActivity.count({ where: { assetId: ids.asset_SRV, status: 'EJECUTADO' } })).toBe(0);
    expect((await c.coord.post(`/failures/${ids.failure}/close`, { note: 'Cierre administrativo del caso' })).status).toBe(201);
  });

  it('falla detectada durante un preventivo genera orden correctiva relacionada', async () => {
    const act = await prisma.scheduledActivity.findFirstOrThrow({ where: { assetId: ids.asset_RED, status: 'PROGRAMADO' } });
    const wo = await c.coord.post(`/workorders/from-activity/${act.id}`, {});
    await c.tech.post(`/workorders/${wo.body.id}/start`);
    const r = await c.tech.post(`/workorders/${wo.body.id}/corrective`, { title: 'Puerto dañado', description: 'Se detectan puertos con errores físicos', safety: 2, care: 3, continuity: 3, assetCondition: 'FUNCIONA_CON_LIMITACIONES' });
    expect(r.status).toBe(201);
    expect(r.body.workOrder.parentWorkOrderId).toBe(wo.body.id);
    expect(r.body.failure.code).toMatch(/^FA-/);
  });
});

// --------------------------------------------------------------------------- 14, 16, 17
describe('14. Hoja de vida, 16. indicadores y 17. años anteriores', () => {
  it('la hoja de vida consolida intervenciones, fallas, repuestos y costos; PDF descargable', async () => {
    const r = await c.coord.get(`/assets/${ids.asset_CMP}/lifecycle`);
    expect(r.status).toBe(200);
    expect(r.body.workOrders.length).toBeGreaterThanOrEqual(1);
    expect(r.body.parts[0].name).toBe('Disco SSD 512 GB');
    expect(r.body.stats.costs.total).toBe(330000);
    expect(r.body.criticality).toHaveLength(1);
    const pdf = await c.coord.get(`/assets/${ids.asset_CMP}/lifecycle/pdf`).buffer(true).parse(binaryParser as never);
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('indicadores calculados desde PostgreSQL responden a filtros y no inventan valores', async () => {
    const d = await c.coord.get(`/dashboard?year=${YEAR}`);
    expect(d.status).toBe(200);
    const g = d.body.general;
    expect(g.executed).toBeGreaterThanOrEqual(1);
    expect(g.complianceBase.denominator).toBeGreaterThan(0);
    expect(g.complianceRescheduled.denominator).toBeGreaterThan(0);
    expect(d.body.times.meanRepairHours.n).toBe(1);
    expect(g.maintenanceCost).toBe(330000 + 1200000);
    const other = await c.coord.get(`/dashboard?year=${YEAR}&areaId=${ctx.areas.sge.id}`);
    expect(other.body.general.totalAssets).toBe(0);
    expect(other.body.general.complianceRescheduled.insufficient).toBe(true);
    expect(other.body.times.meanResponseHours.insufficient).toBe(true);
  });

  it('planifica un año futuro y consulta un año anterior', async () => {
    expect((await c.coord.post(`/plans/${YEAR + 1}`, {})).status).toBe(201);
    const g = await c.coord.post(`/plans/${YEAR + 1}/generate`, {});
    expect(g.body.created).toBeGreaterThan(0);
    expect((await c.coord.post(`/plans/${YEAR - 1}`, {})).status).toBe(201);
    expect((await c.coord.post(`/plans/${YEAR - 1}/generate`, {})).status).toBe(201);
    const prev = await c.coord.get(`/plans/${YEAR - 1}/activities?pageSize=5`);
    expect(prev.status).toBe(200);
    expect(prev.body.items.every((a: { committedDate: string }) => a.committedDate.startsWith(String(YEAR - 1)))).toBe(true);
    const list = await c.coord.get('/plans');
    expect(list.body.map((p: { year: number }) => p.year)).toEqual([YEAR + 1, YEAR, YEAR - 1]);
  });

  it('cierra el plan y lo protege contra modificaciones', async () => {
    expect((await c.coord.post(`/plans/${YEAR - 1}/submit`)).status).toBe(201);
    expect((await c.coord.post(`/plans/${YEAR - 1}/approve`)).status).toBe(201);
    expect((await c.coord.post(`/plans/${YEAR - 1}/close`, { reason: 'x' })).status).toBe(400);
    expect((await c.coord.post(`/plans/${YEAR - 1}/close`, { reason: 'Cierre y archivo anual' })).status).toBe(201);
    expect((await c.coord.post(`/plans/${YEAR - 1}/generate`, { reason: 'Intento posterior al cierre' })).status).toBe(409);
  });

  it('genera los formatos institucionales (F-01, F-07, F-09, F-10, F-12)', async () => {
    for (const url of ['/reports/inventory.pdf', `/reports/failures/${ids.failure}.pdf`, `/reports/monthly.pdf?year=${YEAR}&month=1`, `/reports/compliance.pdf?year=${YEAR}`, '/reports/recurring-failures.pdf']) {
      const r = await c.coord.get(url).buffer(true).parse(binaryParser as never);
      expect([url, r.status]).toEqual([url, 200]);
      expect((r.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    }
    const x = await c.coord.get('/reports/inventory.xlsx').buffer(true).parse(binaryParser as never);
    expect(x.status).toBe(200);
  });
});

// --------------------------------------------------------------------------- 18. Errores de BD
describe('18. Comportamiento ante errores de base de datos', () => {
  const run = (e: unknown) => {
    const filter = new AllExceptionsFilter();
    let status = 0;
    let body: Record<string, unknown> = {};
    const res = { status: (s: number) => ({ json: (b: Record<string, unknown>) => { status = s; body = b; } }) };
    filter.catch(e, { switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ url: '/x' }) }) } as never);
    return { status, body };
  };
  it('BD no disponible → 503 con mensaje seguro', () => {
    const r = run(new Prisma.PrismaClientInitializationError("Can't reach database server", '7'));
    expect(r.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(String(r.body.message)).toMatch(/no está disponible/);
  });
  it('violación de unicidad → 409 sin detalles internos', () => {
    const r = run(new Prisma.PrismaClientKnownRequestError('Unique constraint', { code: 'P2002', clientVersion: '7' }));
    expect(r.status).toBe(409);
  });
  it('rechazos de triggers de integridad → 409 con el mensaje de la regla', () => {
    const e = new Prisma.PrismaClientKnownRequestError('FK', { code: 'P2003', clientVersion: '7', meta: { driverAdapterError: { cause: { originalMessage: 'No se permite eliminar registros de work_orders (use cancelación/anulación)' } } } });
    const r = run(e);
    expect(r.status).toBe(409);
    expect(String(r.body.message)).toMatch(/No se permite eliminar/);
  });
  it('una falla dentro de la transacción no deja cambios parciales', async () => {
    const before = await prisma.scheduledActivity.count();
    const counter = await prisma.counter.findMany();
    // reprogramar a una fecha de otro año falla dentro de la transacción
    const r = await c.coord.post(`/activities/${ids.reschedAct}/reschedule`, { toDate: `${YEAR + 1}-01-05`, reason: 'Intento inválido de reprogramación' });
    expect(r.status).toBe(400);
    expect(await prisma.scheduledActivity.count()).toBe(before);
    expect(await prisma.counter.findMany()).toEqual(counter);
  });
});

// --------------------------------------------------------------------------- 20. Auditoría
describe('20. Auditoría de operaciones críticas', () => {
  it('registra usuario, operación, valores anteriores/nuevos, justificación e IP', async () => {
    const r = await c.auditor.get('/audit?action=APROBAR_REPROGRAMACION');
    expect(r.body.total).toBe(1);
    const e = r.body.items[0];
    expect(e).toMatchObject({ username: 't.coord', module: 'cronograma' });
    expect(e.before.committedDate).toBeTruthy();
    expect(e.after.committedDate).toBeTruthy();
    expect(e.ip).toBeTruthy();
    for (const action of ['LOGIN', 'LOGIN_FALLIDO', 'GENERAR_CRONOGRAMA', 'PLAN_APPROVE', 'CERRAR', 'CANCELAR', 'REPORTAR_FALLA', 'EXPORTAR_PDF', 'CAMBIO_ESTADO', 'ADJUNTAR']) {
      expect([action, (await c.auditor.get(`/audit?action=${action}&pageSize=1`)).body.total > 0]).toEqual([action, true]);
    }
  });
  it('la bitácora es inmutable: UPDATE y DELETE rechazados por la BD', async () => {
    const one = await prisma.auditLog.findFirstOrThrow();
    await expect(prisma.auditLog.update({ where: { id: one.id }, data: { action: 'X' } })).rejects.toThrow(/inmutable/);
    await expect(prisma.auditLog.delete({ where: { id: one.id } })).rejects.toThrow(/inmutable/);
    await expect(prisma.$executeRawUnsafe('TRUNCATE audit_logs')).rejects.toThrow(/inmutable/);
  });
  it('no registra contraseñas ni tokens en la auditoría', async () => {
    const rows = await prisma.auditLog.findMany();
    const text = JSON.stringify(rows.map((r) => [r.before, r.after]));
    expect(text).not.toMatch(/passwordHash|csrfToken|tokenHash/);
  });
});
