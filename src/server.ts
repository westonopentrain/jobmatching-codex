import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { healthRoutes } from './api/health';
import { userRoutes } from './api/users';
import { jobRoutes } from './api/jobs';
import { matchRoutes } from './api/match';
import { adminRoutes } from './api/admin';
import { loggerOptions } from './utils/logger';
import { getEnv, getEnvNumber, requireEnv } from './utils/env';

export function buildServer() {
  const app = Fastify({
    logger: loggerOptions,
  });

  // Custom JSON parser that logs raw body on parse errors
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      const json = JSON.parse(body as string);
      done(null, json);
    } catch (err) {
      // Log the raw body for debugging
      req.log.error(
        {
          event: 'json.parse.error',
          rawBody: typeof body === 'string' ? body.substring(0, 1000) : 'not-a-string',
          bodyLength: typeof body === 'string' ? body.length : 0,
        },
        'Failed to parse JSON body - raw content logged'
      );
      done(err as Error, undefined);
    }
  });

  // Serve static files from public directory
  app.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/static/',
  });

  // Dashboard route - serve the admin UI
  app.get('/dashboard', async (request, reply) => {
    return reply.sendFile('index.html');
  });

  app.register(healthRoutes);
  app.register(userRoutes);
  app.register(jobRoutes);
  app.register(matchRoutes);
  app.register(adminRoutes);

  return app;
}

async function start() {
  const port = getEnvNumber('PORT', 8080);
  // Ensure required environment variables are present before starting the server.
  requireEnv('OPENAI_API_KEY');
  requireEnv('PINECONE_API_KEY');
  requireEnv('PINECONE_INDEX');
  requireEnv('SERVICE_API_KEY');
  const pineconeHost = getEnv('PINECONE_HOST');
  const pineconeEnv = getEnv('PINECONE_ENV') ?? getEnv('PINECONE_CONTROLLER_HOST');
  if (!pineconeHost && !pineconeEnv) {
    throw new Error('Environment variable PINECONE_HOST (preferred) or PINECONE_ENV must be set');
  }

  const app = buildServer();
  if (!pineconeHost && pineconeEnv) {
    app.log.warn(
      { event: 'pinecone.host.fallback', pineconeEnv },
      'PINECONE_HOST not set; using controller host fallback. Update configuration to use the serverless host URL.'
    );
  }
  try {
    await app.listen({ port, host: '0.0.0.0' });
    app.log.info({ port }, 'Server started');
  } catch (error) {
    app.log.error({ err: error }, 'Failed to start server');
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}
