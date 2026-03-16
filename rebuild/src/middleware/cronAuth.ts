import { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env';

export async function cronAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const secret = req.headers['x-cron-secret'] as string;
  if (!secret || secret !== env.cronSecret) {
    reply.status(401).send({ error: 'Unauthorized' });
  }
}
