import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from './auth.types';

/** Filtro Prisma por área según el alcance del rol (ALL | AREA | OWN). */
export function areaFilter(user: AuthUser, field = 'areaId'): Record<string, unknown> {
  if (user.scope === 'AREA') return { [field]: { in: user.areaIds.length ? user.areaIds : ['00000000-0000-0000-0000-000000000000'] } };
  return {};
}

export function assertAreaAccess(user: AuthUser, areaId: string) {
  if (user.scope === 'AREA' && !user.areaIds.includes(areaId)) {
    throw new ForbiddenException('No tiene acceso a registros de esta área');
  }
}

export function can(user: AuthUser, perm: string) {
  return user.permissions.has(perm);
}

export function requirePerm(user: AuthUser, perm: string, msg?: string) {
  if (!user.permissions.has(perm)) throw new ForbiddenException(msg ?? `No tiene el permiso requerido (${perm})`);
}
