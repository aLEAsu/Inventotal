import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthUser, ReqCtx } from '../../common/auth.types';
import { AuditService } from '../../common/audit.service';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../../common/settings.service';

export const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashToken(t: string) {
  return createHash('sha256').update(t).digest('hex');
}

/** Política de contraseñas institucional */
export function validatePasswordPolicy(pwd: string, username: string, minLength = 10): string[] {
  const errs: string[] = [];
  if (pwd.length < minLength) errs.push(`Debe tener al menos ${minLength} caracteres`);
  if (pwd.length > 128) errs.push('Máximo 128 caracteres');
  if (!/[a-z]/.test(pwd)) errs.push('Debe incluir una letra minúscula');
  if (!/[A-Z]/.test(pwd)) errs.push('Debe incluir una letra mayúscula');
  if (!/\d/.test(pwd)) errs.push('Debe incluir un número');
  if (!/[^A-Za-z0-9]/.test(pwd)) errs.push('Debe incluir un símbolo');
  if (username && pwd.toLowerCase().includes(username.toLowerCase())) errs.push('No debe contener el nombre de usuario');
  return errs;
}

export async function hashPassword(pwd: string) {
  return argon2.hash(pwd, ARGON_OPTS);
}

// Hash ficticio para igualar tiempos cuando el usuario no existe (evita enumeración de usuarios)
let DUMMY_HASH: string | null = null;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  async login(username: string, password: string, ip?: string, userAgent?: string) {
    const uname = username.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { username: uname }, include: { role: true } });
    const maxFailed = await this.settings.get<number>('auth.maxFailedAttempts');
    const lockMin = await this.settings.get<number>('auth.lockMinutes');
    const fail = async (reason: string) => {
      await this.prisma.loginAttempt.create({ data: { username: uname, ip, success: false, reason } });
      await this.audit.logAnon({ action: 'LOGIN_FALLIDO', module: 'auth', username: uname, ip, userAgent, reason, userId: user?.id });
    };

    if (!user) {
      DUMMY_HASH ??= await argon2.hash('dummy-password-for-timing', ARGON_OPTS);
      await argon2.verify(DUMMY_HASH, password).catch(() => false);
      await fail('Usuario inexistente');
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await fail('Cuenta bloqueada temporalmente');
      throw new UnauthorizedException(
        'La cuenta está bloqueada temporalmente por intentos fallidos. Intente más tarde o contacte al administrador.',
      );
    }
    const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!ok) {
      const count = user.failedLoginCount + 1;
      const lock = count >= maxFailed;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: lock ? 0 : count, lockedUntil: lock ? new Date(Date.now() + lockMin * 60_000) : null },
      });
      await fail(lock ? 'Contraseña incorrecta: cuenta bloqueada' : 'Contraseña incorrecta');
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }
    if (!user.isActive) {
      await fail('Usuario inactivo');
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }

    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(24).toString('base64url');
    const ttlH = Number(process.env.SESSION_TTL_HOURS ?? 10);
    const session = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
      await tx.loginAttempt.create({ data: { username: uname, ip, success: true } });
      const s = await tx.session.create({
        data: { tokenHash: hashToken(token), csrfToken, userId: user.id, ip, userAgent, expiresAt: new Date(Date.now() + ttlH * 3600_000) },
      });
      await tx.auditLog.create({
        data: { userId: user.id, username: user.username, action: 'LOGIN', module: 'auth', entity: 'Session', entityId: s.id, ip, userAgent },
      });
      return s;
    });
    return { token, csrfToken, expiresAt: session.expiresAt };
  }

  /** Resuelve la sesión a partir del token de la cookie (con expiración deslizante acotada al TTL). */
  async resolveSession(token: string): Promise<AuthUser | null> {
    const s = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { include: { role: { include: { permissions: true } }, areas: true } } },
    });
    if (!s || s.revokedAt || s.expiresAt < new Date() || !s.user.isActive) return null;
    // Cierre por inactividad: 2 horas sin actividad
    if (Date.now() - s.lastSeenAt.getTime() > 2 * 3600_000) {
      await this.prisma.session.update({ where: { id: s.id }, data: { revokedAt: new Date() } });
      return null;
    }
    if (Date.now() - s.lastSeenAt.getTime() > 60_000) {
      await this.prisma.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } });
    }
    const u = s.user;
    return {
      id: u.id,
      username: u.username,
      fullName: u.fullName,
      roleCode: u.role.code,
      roleName: u.role.name,
      scope: u.role.scope,
      permissions: new Set(u.role.permissions.map((p) => p.permissionCode)),
      areaIds: u.areas.map((a) => a.areaId),
      isTechnicalStaff: u.isTechnicalStaff,
      sessionId: s.id,
      csrfToken: s.csrfToken,
      mustChangePassword: u.mustChangePassword,
    };
  }

  async logout(ctx: ReqCtx) {
    await this.prisma.session.update({ where: { id: ctx.user.sessionId }, data: { revokedAt: new Date() } });
    await this.audit.log(ctx, { action: 'LOGOUT', module: 'auth', entity: 'Session', entityId: ctx.user.sessionId });
  }

  async changePassword(ctx: ReqCtx, current: string, next: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
    if (!(await argon2.verify(user.passwordHash, current).catch(() => false))) {
      throw new ForbiddenException('La contraseña actual no es correcta');
    }
    if (current === next) throw new BadRequestException('La nueva contraseña debe ser diferente a la actual');
    const errs = validatePasswordPolicy(next, user.username, await this.settings.get<number>('auth.passwordMinLength'));
    if (errs.length) throw new BadRequestException({ message: 'La contraseña no cumple la política: ' + errs.join('; '), errors: errs });
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(next), mustChangePassword: false, passwordChangedAt: new Date() },
      });
      // Revoca las demás sesiones del usuario
      await tx.session.updateMany({ where: { userId: user.id, id: { not: ctx.user.sessionId }, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log(ctx, { action: 'CAMBIO_CONTRASENA', module: 'auth', entity: 'User', entityId: user.id }, tx);
    });
  }
}
