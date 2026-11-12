import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// `prisma generate` no necesita conexión a la BD; en entornos de build (p. ej. Vercel)
// DATABASE_URL puede no estar definida, así que no se exige aquí. Los comandos
// que sí conectan (migrate, db, studio) fallarán con un error claro si falta.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'ts-node prisma/seed.ts' },
  datasource: { url: process.env.DATABASE_URL },
});
