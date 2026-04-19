import { FastifyInstance } from 'fastify';
import { WebhookEvent } from '@line/bot-sdk';
import { parseWebhook, isCoach } from '../services/line';
import { getOrCreateUser } from '../services/user';
import { handleWebhookEvent, pendingNameSet } from '../handlers/webhook';
import { pushMessage } from '../services/line';

interface LineWebhookPayload {
  events?: WebhookEvent[];
}

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  app.post('/webhook', async (req, reply) => {
    try {
      const body = (req as any).rawBody ?? JSON.stringify(req.body);
      const signature = (req.headers['x-line-signature'] as string) ?? '';
      const payload = parseWebhook(body, signature) as LineWebhookPayload;

      if (!payload.events || payload.events.length === 0) {
        return reply.send('OK');
      }

      for (const e of payload.events) {
        if (e.type === 'message' && e.message.type === 'text') {
          const userId = (e.source as any).userId;
          if (!userId) continue;
          await getOrCreateUser(userId, (e.message as any).text ? undefined : undefined);
          await handleWebhookEvent(e, reply);
        } else if (e.type === 'postback') {
          const userId = (e.source as any).userId;
          if (!userId) continue;
          await getOrCreateUser(userId);
          await handleWebhookEvent(e, reply);
        } else if (e.type === 'follow') {
          const userId = (e.source as any).userId;
          if (userId) {
            await getOrCreateUser(userId);
            if (!isCoach(userId)) {
              pendingNameSet.add(userId);
              await pushMessage(userId, [{ type: 'text', text: '👋 您好！第一次使用請先輸入您的本名（中文全名），方便教練辨識您。' }]);
            }
          }
        }
      }
      return reply.send('OK');
    } catch (err: any) {
      console.error('[webhook]', err);
      reply.status(500).send({ error: err.message });
    }
  });
}
