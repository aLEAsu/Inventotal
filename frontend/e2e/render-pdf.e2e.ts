/** Utilidad de revisión visual: renderiza la primera página de un PDF del backend con el visor de Chromium */
import { test } from '@playwright/test';
test.skip(!process.env.RENDER_PDF, 'solo bajo demanda');
test('render pdf', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Usuario').fill('demo.coordinador');
  await page.locator('#p').fill(process.env.DEMO_PASSWORD!);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  const b64 = await page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: 'include' });
    const buf = new Uint8Array(await r.arrayBuffer());
    let s = ''; for (const x of buf) s += String.fromCharCode(x);
    return btoa(s);
  }, process.env.RENDER_PDF!);
  await page.setContent('<html><body style="margin:0"><canvas id="c"></canvas></body></html>');
  await page.addScriptTag({ path: 'node_modules/pdfjs-dist/build/pdf.min.js' });
  const worker = await import('node:fs').then((fs) => fs.readFileSync('node_modules/pdfjs-dist/build/pdf.worker.min.js', 'utf8'));
  await page.evaluate(async ([data, workerSrc, pageNo]) => {
    const lib = (window as any).pdfjsLib;
    lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' }));
    const pdf = await lib.getDocument({ data: atob(data) }).promise;
    const p = await pdf.getPage(pageNo);
    const vp = p.getViewport({ scale: 1.6 });
    const c = document.getElementById('c') as HTMLCanvasElement;
    c.width = vp.width; c.height = vp.height;
    await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  }, [b64, worker, Number(process.env.PAGE ?? 1)] as const);
  await page.locator('#c').screenshot({ path: `e2e/screens/pdf-${(process.env.RENDER_NAME ?? 'doc')}.png` });
});
