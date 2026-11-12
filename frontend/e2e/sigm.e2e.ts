/**
 * Pruebas de extremo a extremo (Playwright) sobre el entorno de desarrollo con datos de demostración.
 * Requiere: API + frontend en ejecución y semilla demo (npm run seed:demo en backend).
 * Los registros creados por estas pruebas usan el prefijo "E2E".
 */
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const PWD = process.env.DEMO_PASSWORD!;
const YEAR = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric' }).format(new Date()));
const shots = 'e2e/screens';

async function login(page: Page, user: string, pwd = PWD, expectOk = true) {
  await page.goto('/login');
  await page.getByLabel('Usuario').fill(user);
  await page.locator('#p').fill(pwd);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  if (expectOk) await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 });
}

test.beforeAll(() => {
  if (!PWD) throw new Error('Defina DEMO_PASSWORD');
});

test('1. inicio de sesión inválido muestra error y no ingresa', async ({ page }) => {
  await login(page, 'demo.coordinador', 'Clave-Equivocada-1', false);
  await expect(page.getByTestId('login-error')).toContainText('incorrectos');
  await expect(page).toHaveURL(/\/login/);
  await page.screenshot({ path: `${shots}/01-login.png` });
});

test('1b. inicio de sesión válido, dashboard con datos reales y cierre de sesión', async ({ page }) => {
  await login(page, 'demo.coordinador');
  await expect(page.getByRole('heading', { name: 'Resumen ejecutivo del mantenimiento' })).toBeVisible();
  await expect(page.getByText('Activos', { exact: true })).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${shots}/02-dashboard.png`, fullPage: true });
  // la sesión no se guarda en localStorage
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toMatch(/token|csrf|session/i);
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login/);
});

test('2. control de acceso: el solicitante solo ve correctivos y no accede a otras rutas', async ({ page }) => {
  await login(page, 'demo.solicitante');
  await expect(page).toHaveURL(/\/correctivos/);
  const nav = page.locator('aside nav');
  await expect(nav.getByText('Mantenimientos correctivos')).toBeVisible();
  await expect(nav.getByText('Inventario de activos')).toHaveCount(0);
  await page.goto('/auditoria');
  await expect(page.getByRole('heading', { name: 'Sin acceso' })).toBeVisible();
});

test('3. registrar un activo desde el formulario', async ({ page }) => {
  await login(page, 'demo.coordinador');
  await page.goto('/activos');
  await page.getByRole('button', { name: 'Registrar activo' }).click();
  const dlg = page.getByRole('dialog');
  const name = `E2E Computador ${Date.now()}`;
  await dlg.locator('.field', { hasText: 'Nombre del activo' }).locator('input').fill(name);
  const field = (label: RegExp) => dlg.locator('.field').filter({ has: page.locator('label', { hasText: label }) });
  await field(/^Categoría/).locator('.p-select').click();
  await page.getByRole('option', { name: 'Equipos de cómputo' }).click();
  await field(/^Área responsable/).locator('.p-select').click();
  await page.getByRole('option', { name: 'Urgencias' }).click();
  await dlg.locator('.field', { hasText: 'Hostname' }).locator('input').fill('E2E-PC-01');
  await dlg.locator('.field', { hasText: 'Dirección IP' }).locator('input').fill('10.9.9.9');
  await page.screenshot({ path: `${shots}/03-asset-form.png` });
  await dlg.getByRole('button', { name: 'Guardar' }).click();
  await expect(page).toHaveURL(/\/activos\/[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByText('E2E-PC-01')).toBeVisible();
  await page.screenshot({ path: `${shots}/04-asset-detail.png`, fullPage: true });
});

test('5-9. cronograma: matriz, impresión, descarga PDF y Excel; años anteriores', async ({ page, context }) => {
  await login(page, 'demo.coordinador');
  await page.goto('/cronograma');
  await expect(page.getByTestId('matrix')).toBeVisible();
  await expect(page.getByTestId('matrix').locator('tbody tr').first()).toBeVisible();
  await page.screenshot({ path: `${shots}/05-schedule-matrix.png`, fullPage: false });

  // 6. regenerar no duplica
  await page.getByTestId('btn-generate').click();
  await expect(page.getByTestId('gen-created')).toHaveText('0');
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).last().click();

  // 8. PDF real
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByTestId('btn-pdf').click()]);
  expect(pdf.suggestedFilename()).toBe(`Plan_Anual_Mantenimiento_${YEAR}.pdf`);
  const pdfBuf = await readFile((await pdf.path())!);
  expect(pdfBuf.subarray(0, 5).toString()).toBe('%PDF-');
  // 9. Excel real
  const [xlsx] = await Promise.all([page.waitForEvent('download'), page.getByTestId('btn-xlsx').click()]);
  expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
  const xBuf = await readFile((await xlsx.path())!);
  expect(xBuf.subarray(0, 2).toString()).toBe('PK');

  // 7. vista de impresión (sin menú ni botones al imprimir)
  const [print] = await Promise.all([context.waitForEvent('page'), page.getByTestId('btn-print').click().then(() => page.getByTestId('out-print').click())]);
  await print.waitForLoadState();
  await expect(print.getByTestId('print-sheet')).toBeVisible();
  await expect(print.getByText('PLAN ANUAL DE MANTENIMIENTO')).toBeVisible();
  await print.emulateMedia({ media: 'print' });
  await expect(print.locator('.toolbar')).toBeHidden();
  await expect(print.locator('aside')).toHaveCount(0);
  await print.screenshot({ path: `${shots}/06-print-view.png`, fullPage: true });
  const printedPdf = await print.pdf({ landscape: true, format: 'A4', printBackground: true, preferCSSPageSize: true });
  await import('node:fs/promises').then((fs) => fs.writeFile(`${shots}/06-print-view.pdf`, printedPdf));
  expect(printedPdf.length).toBeGreaterThan(10_000);
  await print.close();

  // 17. año anterior seleccionable
  await page.getByTestId('year-select').click();
  await page.getByRole('option', { name: String(YEAR - 1) }).click();
  await expect(page).toHaveURL(new RegExp(`year=${YEAR - 1}`));
  await expect(page.getByText(`No existe plan para ${YEAR - 1}`).or(page.getByTestId('matrix'))).toBeVisible();
});

test('11. el solicitante reporta una falla y obtiene consecutivo', async ({ page }) => {
  await login(page, 'demo.solicitante');
  await page.getByTestId('btn-report').click();
  await page.getByTestId('failure-asset').click();
  await page.getByRole('option').first().click();
  await page.getByTestId('failure-title').fill('E2E Impresora no imprime');
  await page.getByTestId('failure-desc').fill('La impresora de admisiones no responde a los trabajos de impresión');
  await page.screenshot({ path: `${shots}/07-failure-form.png` });
  await page.getByTestId('btn-submit-failure').click();
  await expect(page.locator('.p-toast-message').first()).toContainText(/FA-\d{4}-\d{5}/);
});

test('10/12. coordinador genera orden preventiva y técnico la inicia', async ({ page, browser }) => {
  await login(page, 'demo.coordinador');
  await page.goto('/preventivos');
  await page.getByRole('button', { name: 'Generar OT' }).first().click();
  await expect(page).toHaveURL(/\/ordenes\/[0-9a-f-]{36}/);
  const woUrl = page.url();
  await expect(page.getByText('Asignada', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: `${shots}/08-workorder.png`, fullPage: true });
  const assignee = (await page.locator('dt', { hasText: 'Responsable / técnico' }).locator('xpath=following-sibling::dd').innerText()).trim();
  const user = assignee.includes('Redes') ? 'demo.tecnico2' : 'demo.tecnico';
  const ctx2 = await browser.newContext();
  const tp = await ctx2.newPage();
  await login(tp, user);
  await tp.goto(woUrl);
  await tp.getByTestId('btn-start').click();
  await expect(tp.getByText('En ejecución', { exact: true }).first()).toBeVisible();
  await tp.getByTestId('btn-submit').click();
  await expect(tp.locator('.p-toast-message').first()).toContainText('Faltan campos obligatorios');
  await ctx2.close();
});
