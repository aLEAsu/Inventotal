import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

/** Mismas cabeceras de seguridad que vercel.json, para probar el build con `npm run preview` */
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: false } },
  },
  preview: {
    port: 4173,
    headers: SECURITY_HEADERS,
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: false } },
  },
  build: { chunkSizeWarningLimit: 1500 },
  test: { environment: 'jsdom', include: ['src/**/*.spec.ts'], setupFiles: ['src/test-setup.ts'] },
} as never);
