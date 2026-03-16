import { FastifyError, FastifyRequest, FastifyReply } from 'fastify';

export function errorHandler(err: FastifyError, req: FastifyRequest, reply: FastifyReply): void {
  console.error('[Error]', err.message, err.stack);
  const status = (err as any).statusCode ?? 500;
  reply.status(status).send({
    error: err.message ?? 'Internal Server Error',
  });
}
