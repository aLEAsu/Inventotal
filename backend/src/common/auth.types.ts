import type { Request } from 'express';

export type Scope = 'ALL' | 'AREA' | 'OWN';

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  roleCode: string;
  roleName: string;
  scope: Scope;
  permissions: Set<string>;
  areaIds: string[];
  isTechnicalStaff: boolean;
  sessionId: string;
  csrfToken: string;
  mustChangePassword: boolean;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

/** Contexto de la solicitud que se pasa a los servicios (usuario + datos de auditoría) */
export interface ReqCtx {
  user: AuthUser;
  ip?: string;
  userAgent?: string;
}
