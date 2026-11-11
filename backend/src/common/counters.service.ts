import { Injectable } from '@nestjs/common';
import type { Tx } from './prisma.service';

/**
 * Consecutivos únicos y sin huecos por transacción.
 * Usa INSERT ... ON CONFLICT DO UPDATE ... RETURNING, que bloquea la fila del contador
 * hasta el fin de la transacción: dos solicitudes concurrentes nunca obtienen el mismo número.
 */
@Injectable()
export class CountersService {
  async next(tx: Tx, key: string, year: number): Promise<number> {
    const rows = await tx.$queryRaw<{ value: number }[]>`
      INSERT INTO counters (key, year, value) VALUES (${key}, ${year}, 1)
      ON CONFLICT (key, year) DO UPDATE SET value = counters.value + 1
      RETURNING value`;
    return Number(rows[0].value);
  }

  /** Formato: PREFIJO-AAAA-000123 */
  async nextCode(tx: Tx, prefix: string, year: number, pad = 5): Promise<string> {
    const n = await this.next(tx, prefix, year);
    return `${prefix}-${year}-${String(n).padStart(pad, '0')}`;
  }
}
