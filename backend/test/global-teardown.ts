import { rmSync } from 'node:fs';
import { Client } from 'pg';

/** Elimina únicamente la base efímera creada por global-setup en esta misma ejecución */
export default async function globalTeardown() {
  const name = process.env.SIGM_TEST_DB;
  if (!name || !/^sigm_test_\d+$/.test(name)) return;
  const admin = new URL(process.env.DATABASE_URL!);
  admin.pathname = '/postgres';
  admin.search = '';
  const c = new Client({ connectionString: admin.toString() });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await c.end();
  rmSync(`./storage-test/${name}`, { recursive: true, force: true });
}
