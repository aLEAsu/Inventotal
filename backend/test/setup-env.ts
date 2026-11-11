import { config } from 'dotenv';
// La base efímera de global-setup (DATABASE_URL/STORAGE_DIR) tiene prioridad sobre .env.test
const keep = { DATABASE_URL: process.env.DATABASE_URL, STORAGE_DIR: process.env.STORAGE_DIR, db: process.env.SIGM_TEST_DB };
config({ path: '.env.test', override: true, quiet: true });
if (keep.db) {
  process.env.DATABASE_URL = keep.DATABASE_URL;
  process.env.STORAGE_DIR = keep.STORAGE_DIR;
}
process.env.TZ = 'America/Bogota';
