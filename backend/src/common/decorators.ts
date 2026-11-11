import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AuthRequest, ReqCtx } from './auth.types';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const PERMS = 'perms';
/** Requiere TODOS los permisos indicados */
export const Perms = (...perms: string[]) => SetMetadata(PERMS, perms);

export const ANY_PERMS = 'anyPerms';
/** Requiere AL MENOS UNO de los permisos indicados */
export const AnyPerms = (...perms: string[]) => SetMetadata(ANY_PERMS, perms);

export const ALLOW_PENDING_PWD = 'allowPendingPwd';
/** Permite el acceso aunque el usuario deba cambiar su contraseña */
export const AllowPendingPassword = () => SetMetadata(ALLOW_PENDING_PWD, true);

export const Ctx = createParamDecorator((_d: unknown, ctx: ExecutionContext): ReqCtx => {
  const req = ctx.switchToHttp().getRequest<AuthRequest>();
  return { user: req.user!, ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 300) };
});
