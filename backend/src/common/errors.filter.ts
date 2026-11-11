import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '../generated/prisma/client';

/** Manejo centralizado de excepciones: respuestas uniformes en español, sin filtrar detalles internos. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown> = { message: 'Error interno del servidor. El incidente fue registrado.' };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      body = typeof r === 'string' ? { message: r } : { ...(r as Record<string, unknown>) };
      if (status === 429) body = { message: 'Demasiadas solicitudes. Intente nuevamente en unos minutos.' };
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const original = String((exception.meta as { driverAdapterError?: { cause?: { originalMessage?: string } } } | undefined)?.driverAdapterError?.cause?.originalMessage ?? '');
      if (isTriggerMessage(original)) {
        status = HttpStatus.CONFLICT;
        body = { message: extractTrigger(original) };
      } else if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        body = { message: 'Ya existe un registro con el mismo valor único (código, número o identificador).' };
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        body = { message: 'Registro no encontrado.' };
      } else if (exception.code === 'P2003') {
        status = HttpStatus.CONFLICT;
        body = { message: 'La operación viola una relación con otro registro.' };
      } else if (isTriggerMessage(exception.message)) {
        status = HttpStatus.CONFLICT;
        body = { message: extractTrigger(exception.message) };
      } else {
        this.logger.error({ code: exception.code, msg: exception.message }, 'Error de base de datos');
        status = HttpStatus.SERVICE_UNAVAILABLE;
        body = { message: 'Error de base de datos. La operación no se completó y no se guardaron cambios parciales.' };
      }
    } else if (exception instanceof Prisma.PrismaClientInitializationError || isConnError(exception)) {
      this.logger.error({ err: String(exception) }, 'Base de datos no disponible');
      status = HttpStatus.SERVICE_UNAVAILABLE;
      body = { message: 'La base de datos no está disponible. La operación no se realizó; intente más tarde.' };
    } else {
      const msg = exception instanceof Error ? exception.message : String(exception);
      if (isTriggerMessage(msg)) {
        status = HttpStatus.CONFLICT;
        body = { message: extractTrigger(msg) };
      } else {
        this.logger.error(
          { err: msg, stack: exception instanceof Error ? exception.stack : undefined, path: req.url },
          'Error no controlado',
        );
      }
    }
    res.status(status).json({ statusCode: status, path: req.url, timestamp: new Date().toISOString(), ...body });
  }
}

function isTriggerMessage(m: string): boolean {
  return /inmutable|No se permite eliminar|baja lógica|fecha originalmente aprobada/i.test(m);
}
function extractTrigger(m: string): string {
  const match = m.match(/(La bitácora[^\n"]*|No se permite eliminar[^\n"]*|El activo [^\n"]*baja lógica|La fecha originalmente aprobada[^\n"]*)/i);
  return match ? match[1] : 'Operación rechazada por una regla de integridad.';
}
function isConnError(e: unknown): boolean {
  const m = e instanceof Error ? `${e.message} ${(e as { code?: string }).code ?? ''}` : '';
  return /ECONNREFUSED|ETIMEDOUT|Connection terminated|DatabaseNotReachable|Can.t reach database|connect ECONN/i.test(m);
}
