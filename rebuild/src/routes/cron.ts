import { FastifyInstance } from 'fastify';
import { env } from '../config/env';
import { sendTomorrowReminders, sendExpiryWarnings, sendCoachDigest } from '../services/notification';

export async function cronRoutes(app: FastifyInstance): Promise<void> {
  async function verifyCron(req: any, reply: any) {
    const secret = req.headers['x-cron-secret'];
    if (!secret || secret !== env.cronSecret) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  }

  app.post('/api/cron/reminders', { preHandler: verifyCron }, async (req, reply) => {
    try {
      const { sent, skipped } = await sendTomorrowReminders();
      return { ok: true, sent, skipped };
    } catch (err: any) {
      console.error('[cron/reminders]', err);
      reply.status(500).send({ error: err.message });
    }
  });

  app.post('/api/cron/expiry', { preHandler: verifyCron }, async (req, reply) => {
    try {
      const sent = await sendExpiryWarnings();
      return { ok: true, sent };
    } catch (err: any) {
      console.error('[cron/expiry]', err);
      reply.status(500).send({ error: err.message });
    }
  });

  app.post('/api/cron/coach-digest', { preHandler: verifyCron }, async (req, reply) => {
    try {
      const coachId = env.coachLineUserIds[0];
      if (!coachId) {
        return { ok: true, lessons: 0, message: 'No coach configured' };
      }
      const lessons = await sendCoachDigest(coachId);
      return { ok: true, lessons };
    } catch (err: any) {
      console.error('[cron/coach-digest]', err);
      reply.status(500).send({ error: err.message });
    }
  });
}
