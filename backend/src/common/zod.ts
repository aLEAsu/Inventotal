import { applyDecorators, ArgumentMetadata, BadRequestException, Body, PipeTransform, Query } from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import { z, ZodType } from 'zod';
import { isYmd } from './dates';

export class ZodPipe<T extends ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}
  transform(value: unknown, _meta: ArgumentMetadata): z.infer<T> {
    const r = this.schema.safeParse(value ?? {});
    if (!r.success) {
      throw new BadRequestException({
        message: 'Datos inválidos: ' + r.error.issues.map((i) => `${i.path.join('.') || 'valor'}: ${i.message}`).join('; '),
        errors: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return r.data;
  }
}

function jsonSchema(schema: ZodType): Record<string, unknown> {
  try {
    return z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' }) as Record<string, unknown>;
  } catch {
    return { type: 'object' };
  }
}

/** Valida el body con Zod */
export const ZBody = (schema: ZodType) => Body(new ZodPipe(schema));
/** Valida el query string con Zod */
export const ZQuery = (schema: ZodType) => Query(new ZodPipe(schema));
/** Documenta el body en Swagger a partir del esquema Zod */
export const ApiZBody = (schema: ZodType) => applyDecorators(ApiBody({ schema: jsonSchema(schema) as never }));
export const ApiZQuery = (schema: ZodType) => {
  const js = jsonSchema(schema) as { properties?: Record<string, Record<string, unknown>> };
  return applyDecorators(
    ...Object.entries(js.properties ?? {}).map(([name, s]) => ApiQuery({ name, required: false, schema: s as never })),
  );
};

// ---- Primitivas reutilizables
export const zYmd = z.string().refine(isYmd, 'Fecha inválida (formato AAAA-MM-DD)');
export const zUuid = z.string().uuid('Identificador inválido');
export const zText = (min = 1, max = 2000) => z.string().trim().min(min, `Mínimo ${min} caracteres`).max(max, `Máximo ${max} caracteres`);
export const zOptText = (max = 4000) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v === '' || v === undefined ? null : v));
export const zOptUuid = z
  .union([z.string().uuid('Identificador inválido'), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v ? v : null));
export const zOptYmd = z
  .union([zYmd, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v ? v : null));
export const zReason = z.string().trim().min(10, 'La justificación debe tener al menos 10 caracteres').max(2000);
export const zMoney = z.coerce.number().min(0, 'No puede ser negativo').max(999_999_999_999);
export const zPage = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(25),
  q: z.string().trim().max(200).optional(),
};
export const zBoolQ = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true'));
