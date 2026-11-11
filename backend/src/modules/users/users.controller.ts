import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { diff, AuditService } from '../../common/audit.service';
import type { ReqCtx } from '../../common/auth.types';
import { Ctx, Perms } from '../../common/decorators';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { ApiZBody, ApiZQuery, zPage, ZBody, ZodPipe, ZQuery } from '../../common/zod';
import { hashPassword, validatePasswordPolicy } from '../auth/auth.service';

const UserCreate = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, 'Usuario: 3-40 caracteres (letras, números, . _ -)'),
  fullName: z.string().trim().min(3).max(150),
  email: z.string().trim().email('Correo inválido').optional().nullable().or(z.literal('').transform(() => null)),
  documentId: z.string().trim().max(30).optional().nullable(),
  position: z.string().trim().max(120).optional().nullable(),
  roleId: z.string().uuid(),
  areaIds: z.array(z.string().uuid()).default([]),
  isTechnicalStaff: z.boolean().default(false),
  password: z.string().min(1).max(128),
});
const UserUpdate = UserCreate.omit({ username: true, password: true }).partial().extend({ isActive: z.boolean().optional() });
const ResetPwd = z.object({ password: z.string().min(1).max(128) });
const UserQuery = z.object({ ...zPage, roleId: z.string().uuid().optional(), active: z.enum(['true', 'false']).optional() });

const userSelect = {
  id: true, username: true, fullName: true, email: true, documentId: true, position: true, isActive: true,
  isTechnicalStaff: true, mustChangePassword: true, lastLoginAt: true, lockedUntil: true, createdAt: true,
  role: { select: { id: true, code: true, name: true, scope: true } },
  areas: { select: { area: { select: { id: true, name: true } } } },
} as const;

@ApiTags('Usuarios y permisos')
@Controller()
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  @Get('users')
  @Perms('users.read')
  @ApiZQuery(UserQuery)
  async list(@ZQuery(UserQuery) q: z.infer<typeof UserQuery>) {
    const where = {
      ...(q.roleId ? { roleId: q.roleId } : {}),
      ...(q.active ? { isActive: q.active === 'true' } : {}),
      ...(q.q ? { OR: [{ fullName: { contains: q.q, mode: 'insensitive' as const } }, { username: { contains: q.q, mode: 'insensitive' as const } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({ where, select: userSelect, orderBy: { fullName: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.user.count({ where }),
    ]);
    return { items: items.map(flatUser), total };
  }

  /** Lista resumida para selectores (responsables, técnicos) — disponible a cualquier usuario autenticado */
  @Get('users/options')
  async options() {
    const users = await this.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, fullName: true, isTechnicalStaff: true, role: { select: { code: true } } },
      orderBy: { fullName: 'asc' },
    });
    return users.map((u) => ({ id: u.id, fullName: u.fullName, roleCode: u.role.code, isTechnicalStaff: u.isTechnicalStaff }));
  }

  @Post('users')
  @Perms('users.manage')
  @ApiZBody(UserCreate)
  async create(@Ctx() ctx: ReqCtx, @ZBody(UserCreate) b: z.infer<typeof UserCreate>) {
    const errs = validatePasswordPolicy(b.password, b.username, await this.settings.get<number>('auth.passwordMinLength'));
    if (errs.length) throw new BadRequestException({ message: 'La contraseña no cumple la política: ' + errs.join('; '), errors: errs });
    return this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          username: b.username, fullName: b.fullName, email: b.email ?? null, documentId: b.documentId ?? null,
          position: b.position ?? null, roleId: b.roleId, isTechnicalStaff: b.isTechnicalStaff,
          passwordHash: await hashPassword(b.password), mustChangePassword: true,
          areas: { create: b.areaIds.map((areaId) => ({ areaId })) },
        },
        select: userSelect,
      });
      await this.audit.log(ctx, { action: 'CREAR', module: 'usuarios', entity: 'User', entityId: u.id, after: flatUser(u) }, tx);
      return flatUser(u);
    });
  }

  @Patch('users/:id')
  @Perms('users.manage')
  @ApiZBody(UserUpdate)
  async update(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(UserUpdate) b: z.infer<typeof UserUpdate>) {
    if (id === ctx.user.id && (b.isActive === false || b.roleId)) {
      throw new ForbiddenException('No puede desactivar ni cambiar el rol de su propio usuario');
    }
    return this.prisma.$transaction(async (tx) => {
      const before = flatUser(await tx.user.findUniqueOrThrow({ where: { id }, select: userSelect }));
      const { areaIds, ...data } = b;
      await tx.user.update({ where: { id }, data: { ...data, email: data.email === undefined ? undefined : data.email } });
      if (areaIds) {
        await tx.userArea.deleteMany({ where: { userId: id } });
        await tx.userArea.createMany({ data: areaIds.map((areaId) => ({ userId: id, areaId })) });
      }
      if (b.isActive === false || b.roleId) {
        await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      const after = flatUser(await tx.user.findUniqueOrThrow({ where: { id }, select: userSelect }));
      await this.audit.log(ctx, { action: 'EDITAR', module: 'usuarios', entity: 'User', entityId: id, ...diff(before, after) }, tx);
      return after;
    });
  }

  @Post('users/:id/reset-password')
  @Perms('users.manage')
  @ApiZBody(ResetPwd)
  async resetPassword(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @ZBody(ResetPwd) b: z.infer<typeof ResetPwd>) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    const errs = validatePasswordPolicy(b.password, u.username, await this.settings.get<number>('auth.passwordMinLength'));
    if (errs.length) throw new BadRequestException({ message: 'La contraseña no cumple la política: ' + errs.join('; '), errors: errs });
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { passwordHash: await hashPassword(b.password), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null },
      });
      await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log(ctx, { action: 'RESTABLECER_CONTRASENA', module: 'usuarios', entity: 'User', entityId: id }, tx);
    });
    return { ok: true };
  }

  @Post('users/:id/unlock')
  @Perms('users.manage')
  async unlock(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.user.update({ where: { id }, data: { failedLoginCount: 0, lockedUntil: null } });
    await this.audit.log(ctx, { action: 'DESBLOQUEAR', module: 'usuarios', entity: 'User', entityId: id });
    return { ok: true };
  }

  // ---------------- Roles y permisos
  @Get('roles')
  @Perms('users.read')
  async roles() {
    const roles = await this.prisma.role.findMany({ include: { permissions: true, _count: { select: { users: true } } }, orderBy: { name: 'asc' } });
    return roles.map((r) => ({ ...r, permissions: r.permissions.map((p) => p.permissionCode), userCount: r._count.users, _count: undefined }));
  }

  @Get('permissions')
  @Perms('users.read')
  permissions() {
    return this.prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { code: 'asc' }] });
  }

  @Put('roles/:id/permissions')
  @Perms('users.manage')
  async setRolePermissions(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ permissions: z.array(z.string()) }))) b: { permissions: string[] }) {
    const role = await this.prisma.role.findUniqueOrThrow({ where: { id }, include: { permissions: true } });
    if (role.code === 'ADMIN') throw new ForbiddenException('Los permisos del rol Administrador no se pueden reducir');
    const valid = new Set((await this.prisma.permission.findMany()).map((p) => p.code));
    const invalid = b.permissions.filter((p) => !valid.has(p));
    if (invalid.length) throw new BadRequestException(`Permisos inexistentes: ${invalid.join(', ')}`);
    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.rolePermission.createMany({ data: b.permissions.map((permissionCode) => ({ roleId: id, permissionCode })) });
      await this.audit.log(ctx, {
        action: 'EDITAR_PERMISOS', module: 'usuarios', entity: 'Role', entityId: id,
        before: role.permissions.map((p) => p.permissionCode), after: b.permissions,
      }, tx);
    });
    return { ok: true };
  }
}

function flatUser(u: { areas: { area: { id: string; name: string } }[] } & Record<string, unknown>) {
  return { ...u, areas: u.areas.map((a) => a.area) };
}
