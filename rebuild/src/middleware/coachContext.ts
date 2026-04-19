import { FastifyReply, FastifyRequest } from 'fastify';
import { getCoachConfig } from '../services/coach';
import type { Coach } from '../types/coach';

declare module 'fastify' {
  interface FastifyRequest {
    coachId?: string;
    coach?: Coach;
  }
}

function extractCoachId(req: FastifyRequest): string | undefined {
  const params = req.params as { coachId?: string } | undefined;
  if (params?.coachId) return params.coachId;

  const header = req.headers['x-coach-id'];
  if (typeof header === 'string' && header) return header;

  const query = req.query as { coachId?: string } | undefined;
  if (query?.coachId) return query.coachId;

  return undefined;
}

export async function coachContext(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const coachId = extractCoachId(req);
  if (!coachId) {
    reply.status(400).send({ error: 'Missing coachId' });
    return;
  }

  const coach = await getCoachConfig(coachId);
  if (!coach) {
    reply.status(404).send({ error: 'Coach not found' });
    return;
  }

  req.coachId = coachId;
  req.coach = coach;
}
