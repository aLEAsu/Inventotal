/**
 * Utilidad de revisión visual (bajo demanda): renderiza una página de un PDF con pdf.js local.
 *   RENDER_PDF=/api/v1/plans/2026/export.pdf  → descarga el PDF desde la API (sesión demo.coordinador)
 *   RENDER_FILE=ruta/archivo.pdf              → renderiza un PDF local
 *   PAGE=n (por defecto 1) · RENDER_NAME=nombre de la imagen en e2e/screens
 */
import { test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.skip(!process.env.RENDER_PDF && !process.env.RENDER_FILE, 'solo bajo demanda');

test('render pdf', async ({ page }) => {
  let b64: string;
  if (process.env.RENDER_FILE) {
    b64 = readFileSync(process.env.RENDER_FILE).toString('base64');
  } else {
    await page.goto('/login');
    await page.getByLabel('Usuario').fill('demo.coordinador');
    await page.locator('#p').fill(process.env.DEMO_PASSWORD!);
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
    b64 = await page.evaluate(async (u) => {
      const r = await fetch(u, { credentials: 'include' });
      const buf = new Uint8Array(await r.arrayBuffer());
      let s = '';
      for (const x of buf) s += String.fromCharCode(x);
      return btoa(s);
    }, process.env.RENDER_PDF!);
  }
  await renderB64(page, b64);
});

async function renderB64(page: Page, b64: string) {
  await page.setContent('<html><body style="margin:0"><canvas id="c"></canvas></body></html>');
  await page.addScriptTag({ path: 'node_modules/pdfjs-dist/build/pdf.min.js' });
  const worker = readFileSync('node_modules/pdfjs-dist/build/pdf.worker.min.js', 'utf8');
  await page.evaluate(
    async ([data, workerSrc, pageNo]) => {
      const lib = (window as unknown as { pdfjsLib: any }).pdfjsLib;
      lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' }));
      const pdf = await lib.getDocument({ data: atob(data) }).promise;
      const p = await pdf.getPage(pageNo);
      const vp = p.getViewport({ scale: 1.6 });
      const c = document.getElementById('c') as HTMLCanvasElement;
      c.width = vp.width;
      c.height = vp.height;
      await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    },
    [b64, worker, Number(process.env.PAGE ?? 1)] as const,
  );
  await page.locator('#c').screenshot({ path: `e2e/screens/pdf-${process.env.RENDER_NAME ?? 'doc'}.png` });
}
