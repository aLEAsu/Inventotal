/**
 * Creación SEGURA del administrador inicial.
 *   ADMIN_USERNAME=admin ADMIN_FULLNAME="Nombre" npm run create-admin
 * - Si ADMIN_PASSWORD no se define, se genera una contraseña aleatoria fuerte que se muestra UNA sola vez.
 * - El usuario queda obligado a cambiar la contraseña en el primer ingreso.
 * - No sobrescribe un administrador existente.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { poolConfig } from '../src/common/prisma.service';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '../src/generated/prisma/client';
import { hashPassword, validatePasswordPolicy } from '../src/modules/auth/auth.service';

function strongPassword() {
  const base = randomBytes(18).toString('base64url');
  return `${base.slice(0, 6)}A9!${base.slice(6, 16)}z`;
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg(poolConfig(process.env.DATABASE_URL!) as never) });
  try {
    const username = (process.env.ADMIN_USERNAME ?? 'admin').trim().toLowerCase();
    const fullName = process.env.ADMIN_FULLNAME ?? 'Administrador del sistema';
    const role = await prisma.role.findUnique({ where: { code: 'ADMIN' } });
    if (!role) throw new Error('Ejecute primero la semilla base (npm run seed)');
    if (await prisma.user.findUnique({ where: { username } })) {
      console.log(`El usuario "${username}" ya existe. No se realizaron cambios.`);
      return;
    }
    const generated = !process.env.ADMIN_PASSWORD;
    const password = process.env.ADMIN_PASSWORD ?? strongPassword();
    const errs = validatePasswordPolicy(password, username);
    if (errs.length) throw new Error(`La contraseña no cumple la política: ${errs.join('; ')}`);
    const u = await prisma.user.create({
      data: { username, fullName, roleId: role.id, passwordHash: await hashPassword(password), mustChangePassword: true, isTechnicalStaff: true },
    });
    await prisma.auditLog.create({ data: { action: 'CREAR_ADMIN_INICIAL', module: 'usuarios', entity: 'User', entityId: u.id, username: 'sistema' } });
    console.log(`Administrador "${username}" creado.`);
    if (generated) {
      console.log('Contraseña temporal (se muestra una sola vez, cámbiela en el primer ingreso):');
      console.log(password);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
