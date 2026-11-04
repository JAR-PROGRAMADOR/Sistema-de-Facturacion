import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

/** Error de negocio con código estable y mensaje apto para el usuario. */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** Formato único de errores: { error: { code, message, details? } }. Nunca expone trazas. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: 'El recurso solicitado no existe.' },
    }),
  );

  app.setErrorHandler((error: FastifyError, req, reply) => {
    const err: unknown = error;

    if (err instanceof AppError) {
      return reply
        .status(err.status)
        .send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Los datos enviados no son válidos. Revísalos e inténtalo de nuevo.',
          details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
        },
      });
    }
    if (error.validation) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Los datos enviados no son válidos. Revísalos e inténtalo de nuevo.',
          details: error.validation,
        },
      });
    }
    if (error.statusCode === 429) {
      return reply.status(429).send({
        error: { code: 'RATE_LIMITED', message: 'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.' },
      });
    }
    req.log.error({ err: error }, 'Error no controlado');
    return reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'No fue posible completar la operación. Inténtalo nuevamente.' },
    });
  });
}
