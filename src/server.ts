import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { jsonrepair } from 'jsonrepair';
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

  // Custom JSON parser that sanitizes curly quotes and repairs malformed JSON
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      // Sanitize curly/smart quotes from Bubble before parsing
      // Bubble wraps values in curly quotes like: "title": ""value""
      // We need to REMOVE these curly quotes, not replace them with straight quotes
      let sanitized = body as string;
      sanitized = sanitized.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, ''); // remove curly double quotes
      sanitized = sanitized.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, ''); // remove curly single quotes

      const json = JSON.parse(sanitized);
      done(null, json);
    } catch (err) {
      // Try to repair malformed JSON (e.g., unescaped quotes in strings from Bubble)
      try {
        const sanitized = (body as string)
          .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '')
          .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, '');
        const repaired = jsonrepair(sanitized);
        const json = JSON.parse(repaired);
        req.log.info(
          {
            event: 'json.repair.success',
            originalLength: typeof body === 'string' ? body.length : 0,
          },
          'Successfully repaired malformed JSON'
        );
        done(null, json);
      } catch (repairErr) {
        // Log the raw body for debugging
        req.log.error(
          {
            event: 'json.parse.error',
            rawBody: typeof body === 'string' ? body.substring(0, 2000) : 'not-a-string',
            bodyLength: typeof body === 'string' ? body.length : 0,
          },
          'Failed to parse JSON body - raw content logged'
        );
        done(err as Error, undefined);
      }
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
