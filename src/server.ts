import Fastify from 'fastify';
import { healthRoutes } from './api/health';
import { userRoutes } from './api/users';
import { loggerOptions } from './utils/logger';
import { getEnv, getEnvNumber, requireEnv } from './utils/env';

export function buildServer() {
  const app = Fastify({
    logger: loggerOptions,
  });

  app.register(healthRoutes);
  app.register(userRoutes);

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
