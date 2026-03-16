import 'dotenv/config';
import Fastify from 'fastify';
import { initFirebase } from './config/firebase';
import { healthRoutes } from './routes/health';
import { cronRoutes } from './routes/cron';
import { webhookRoutes } from './routes/webhook';
import { liffRoutes } from './routes/liff';
import { errorHandler } from './middleware/errorHandler';

async function main() {
  initFirebase();

  const app = Fastify({
    logger: true,
  });

  // CORS：允許 LIFF 頁面跨域呼叫 API
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') return reply.send();
  });

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      (req as any).rawBody = body;
      const json = typeof body === 'string' ? JSON.parse(body) : body;
      done(null, json);
    } catch (err: any) {
      done(err, undefined);
    }
  });

  app.setErrorHandler(errorHandler);

  await app.register(healthRoutes);
  await app.register(cronRoutes);
  await app.register(webhookRoutes);
  await app.register(liffRoutes);

  const port = parseInt(process.env.PORT ?? '8080', 10);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`Server listening on port ${port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
