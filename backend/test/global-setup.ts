/**
 * Crea una base de datos efímera y exclusiva para esta ejecución de pruebas
 * (sigm_test_<timestamp>), aplica las migraciones y la elimina al terminar.
 * Nunca toca las bases de desarrollo ni producción.
 */
import { config } from 'dotenv';
import { execSync } from 'node:child_process';
import { Client } from 'pg';

export default async function globalSetup() {
  config({ path: '.env.test', override: true, quiet: true });
  const base = new URL(process.env.DATABASE_URL!);
  const name = `sigm_test_${Date.now()}`;
  const admin = new URL(base.toString());
  admin.pathname = '/postgres';
  admin.search = '';
  const c = new Client({ connectionString: admin.toString() });
  await c.connect();
  await c.query(`CREATE DATABASE ${name}`);
  await c.end();
  const url = new URL(base.toString());
  url.pathname = `/${name}`;
  process.env.DATABASE_URL = url.toString();
  process.env.SIGM_TEST_DB = name;
  process.env.STORAGE_DIR = `./storage-test/${name}`;
  execSync('npx prisma migrate deploy', { env: { ...process.env }, stdio: 'pipe' });
}
