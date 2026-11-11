import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import type { AuthRequest } from '../../common/auth.types';
import { ALLOW_PENDING_PWD, ANY_PERMS, IS_PUBLIC, PERMS } from '../../common/decorators';
import { AuthService } from './auth.service';

export const SESSION_COOKIE = 'sigm_session';
export const CSRF_COOKIE = 'sigm_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function safeEq(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Guardia global:
 *  1. Autenticación por cookie de sesión HttpOnly (token opaco, hash en BD).
 *  2. Protección CSRF (token sincronizado por sesión enviado en cabecera X-CSRF-Token).
 *  3. Autorización por permisos granulares declarados con @Perms / @AnyPerms.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (!token) throw new UnauthorizedException('Sesión no iniciada');
    const user = await this.auth.resolveSession(token);
    if (!user) throw new UnauthorizedException('La sesión expiró o no es válida');

    if (!SAFE_METHODS.has(req.method)) {
      const header = req.headers[CSRF_HEADER];
      if (typeof header !== 'string' || !safeEq(header, user.csrfToken)) {
        throw new ForbiddenException('Token CSRF inválido o ausente');
      }
    }
    req.user = user;

    if (user.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PWD, targets)) {
      throw new ForbiddenException({ message: 'Debe cambiar su contraseña antes de continuar', code: 'MUST_CHANGE_PASSWORD' });
    }

    const all = this.reflector.getAllAndOverride<string[]>(PERMS, targets) ?? [];
    const any = this.reflector.getAllAndOverride<string[]>(ANY_PERMS, targets) ?? [];
    const missing = all.filter((p) => !user.permissions.has(p));
    if (missing.length) throw new ForbiddenException(`Acceso denegado: requiere ${missing.join(', ')}`);
    if (any.length && !any.some((p) => user.permissions.has(p))) {
      throw new ForbiddenException(`Acceso denegado: requiere alguno de ${any.join(', ')}`);
    }
    return true;
  }
}
