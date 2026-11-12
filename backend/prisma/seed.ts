/**
 * Semilla BASE (idempotente): permisos, roles, categorías, criterios de criticidad,
 * formatos documentales, procedimientos y parámetros. No crea usuarios ni datos de demostración.
 *   npm run seed
 * El usuario administrador inicial se crea con: npm run create-admin
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { poolConfig } from '../src/common/prisma.service';
import { PrismaClient } from '../src/generated/prisma/client';
import { PERMISSIONS, ROLES } from '../src/common/permissions';
import { DEFAULT_SETTINGS } from '../src/common/settings.service';
import { CATEGORIES, CRITERIA, FORMATS, PROCEDURES } from './base-data';

export async function seedBase(prisma: PrismaClient) {
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({ where: { code: p.code }, update: { module: p.module, action: p.action, description: p.description }, create: p });
  }
  for (const r of ROLES) {
    const role = await prisma.role.upsert({
      where: { code: r.code },
      update: { name: r.name, description: r.description, scope: r.scope, isSystem: true },
      create: { code: r.code, name: r.name, description: r.description, scope: r.scope, isSystem: true },
    });
    // Solo se asignan permisos iniciales si el rol no tiene ninguno (no se sobrescriben ajustes institucionales)
    const count = await prisma.rolePermission.count({ where: { roleId: role.id } });
    if (count === 0 || r.code === 'ADMIN') {
      await prisma.rolePermission.createMany({ data: r.permissions.map((permissionCode) => ({ roleId: role.id, permissionCode })), skipDuplicates: true });
    }
  }
  for (const c of CATEGORIES) {
    const cat = await prisma.assetCategory.upsert({
      where: { code: c.code },
      update: {},
      create: { code: c.code, name: c.name, color: c.color, description: c.description },
    });
    for (const s of c.subs) {
      await prisma.assetSubcategory.upsert({ where: { categoryId_name: { categoryId: cat.id, name: s } }, update: {}, create: { categoryId: cat.id, name: s } });
    }
  }
  for (const c of CRITERIA) {
    await prisma.criticalityCriterion.upsert({ where: { code: c.code }, update: {}, create: { ...c, maxScore: 5 } });
  }
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  for (const f of FORMATS) {
    await prisma.documentFormat.upsert({
      where: { code: f.code },
      update: {},
      create: { ...f, effectiveDate: today, changeLog: [{ version: '1', date: today.toISOString().slice(0, 10), description: 'Emisión inicial' }] },
    });
  }
  for (const p of PROCEDURES) {
    await prisma.procedure.upsert({ where: { code: p.code }, update: {}, create: p });
  }
  for (const [key, d] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value: d.value as never, description: d.description } });
  }
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg(poolConfig(process.env.DATABASE_URL!) as never) });
  try {
    await seedBase(prisma);
    console.log('Semilla base aplicada correctamente.');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
