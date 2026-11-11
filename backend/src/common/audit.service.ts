import { Injectable, Logger } from '@nestjs/common';
import type { ReqCtx } from './auth.types';
import { PrismaService, Tx } from './prisma.service';

export interface AuditEntry {
  action: string;
  module: string;
  entity?: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

const SENSITIVE = /password|passwordHash|tokenHash|csrfToken|secret/i;

/** Serializa valores (Decimal, BigInt, Date) y elimina campos sensibles. */
export function sanitize(v: unknown): unknown {
  if (v === null || v === undefined) return v ?? null;
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(sanitize);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown> & { toFixed?: unknown; d?: unknown };
    if (typeof o.toFixed === 'function' && 'd' in o) return o.toString();
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(o)) {
      if (SENSITIVE.test(k)) continue;
      out[k] = sanitize(val);
    }
    return out;
  }
  return v;
}

/** Devuelve solo los campos que cambiaron (para registrar valores anteriores y nuevos) */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  const sb = sanitize(before) as Record<string, unknown>;
  const sa = sanitize(after) as Record<string, unknown>;
  for (const k of Object.keys(sa)) {
    if (k === 'updatedAt') continue;
    if (JSON.stringify(sb[k]) !== JSON.stringify(sa[k])) {
      b[k] = sb[k] ?? null;
      a[k] = sa[k] ?? null;
    }
  }
  return { before: b, after: a };
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');
  constructor(private readonly prisma: PrismaService) {}

  /** Registra en la bitácora. Si se pasa `tx`, queda dentro de la misma transacción. */
  async log(ctx: ReqCtx | null, e: AuditEntry, tx?: Tx) {
    const db = tx ?? this.prisma;
    await db.auditLog.create({
      data: {
        userId: ctx?.user?.id ?? null,
        username: ctx?.user?.username ?? null,
        action: e.action,
        module: e.module,
        entity: e.entity ?? null,
        entityId: e.entityId ?? null,
        before: (sanitize(e.before) ?? undefined) as never,
        after: (sanitize(e.after) ?? undefined) as never,
        reason: e.reason ?? null,
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent ?? null,
      },
    });
    this.logger.log({ action: e.action, module: e.module, entity: e.entity, entityId: e.entityId, user: ctx?.user?.username });
  }

  /** Para eventos sin sesión (p. ej. intento de inicio de sesión) */
  async logAnon(e: AuditEntry & { username?: string; ip?: string; userAgent?: string; userId?: string }) {
    await this.prisma.auditLog.create({
      data: {
        userId: e.userId ?? null,
        username: e.username ?? null,
        action: e.action,
        module: e.module,
        entity: e.entity ?? null,
        entityId: e.entityId ?? null,
        after: (sanitize(e.after) ?? undefined) as never,
        reason: e.reason ?? null,
        ip: e.ip ?? null,
        userAgent: e.userAgent ?? null,
      },
    });
  }
}
