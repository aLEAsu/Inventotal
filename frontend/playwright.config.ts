import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Credenciales de prueba: DEMO_PASSWORD de backend/.env (entorno de desarrollo; nunca producción)
if (!process.env.DEMO_PASSWORD) {
  try {
    const env = readFileSync('../backend/.env', 'utf8');
    const m = /^DEMO_PASSWORD=(.+)$/m.exec(env);
    if (m) process.env.DEMO_PASSWORD = m[1].trim();
  } catch {
    /* definir DEMO_PASSWORD en el entorno */
  }
}

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    { command: 'npm --prefix ../backend run start:dev', url: 'http://localhost:3000/api/v1/health', reuseExistingServer: true, timeout: 120_000 },
    { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true, timeout: 120_000 },
  ],
});
