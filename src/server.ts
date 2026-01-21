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

  // Sanitize JSON string from Bubble - handles curly quotes and control characters
  function sanitizeJsonString(raw: string): string {
    let s = raw;
    // Remove curly/smart quotes
    s = s.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, ''); // curly double quotes
    s = s.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, ''); // curly single quotes
    // Remove other problematic unicode characters
    s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); // control chars except \t \n \r
    return s;
  }

  // Custom JSON parser that sanitizes and repairs malformed JSON from Bubble
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    const rawBody = body as string;

    try {
      // First attempt: sanitize and parse directly
      const sanitized = sanitizeJsonString(rawBody);
      const json = JSON.parse(sanitized);
      done(null, json);
    } catch (err) {
      // Second attempt: use jsonrepair for structural issues (unescaped quotes, etc.)
      try {
        const sanitized = sanitizeJsonString(rawBody);
        const repaired = jsonrepair(sanitized);
        const json = JSON.parse(repaired);
        req.log.info(
          {
            event: 'json.repair.success',
            originalLength: rawBody.length,
          },
          'Successfully repaired malformed JSON'
        );
        done(null, json);
      } catch (repairErr) {
        // Third attempt: aggressive repair - try to extract and fix the JSON structure
        try {
          // Sometimes the body has trailing garbage or is truncated
          // Try to find a valid JSON object by balancing braces
          let sanitized = sanitizeJsonString(rawBody);

          // If the JSON ends abruptly mid-string, try to close it properly
          // Count open braces and brackets
          let braceCount = 0;
          let bracketCount = 0;
          let inString = false;
          let escaped = false;

          for (let i = 0; i < sanitized.length; i++) {
            const char = sanitized[i];
            if (escaped) {
              escaped = false;
              continue;
            }
            if (char === '\\') {
              escaped = true;
              continue;
            }
            if (char === '"') {
              inString = !inString;
              continue;
            }
            if (!inString) {
              if (char === '{') braceCount++;
              else if (char === '}') braceCount--;
              else if (char === '[') bracketCount++;
              else if (char === ']') bracketCount--;
            }
          }

          // If we're in a string and have unclosed braces, try to close them
          if (inString || braceCount > 0 || bracketCount > 0) {
            // Close any open string
            if (inString) sanitized += '"';
            // Close brackets and braces
            while (bracketCount > 0) {
              sanitized += ']';
              bracketCount--;
            }
            while (braceCount > 0) {
              sanitized += '}';
              braceCount--;
            }

            const repaired = jsonrepair(sanitized);
            const json = JSON.parse(repaired);
            req.log.info(
              {
                event: 'json.repair.truncated',
                originalLength: rawBody.length,
                addedClosing: true,
              },
              'Repaired truncated JSON by adding closing delimiters'
            );
            done(null, json);
            return;
          }

          // If we get here, try one more repair attempt
          const repaired = jsonrepair(sanitized);
          const json = JSON.parse(repaired);
          req.log.info(
            {
              event: 'json.repair.success',
              originalLength: rawBody.length,
            },
            'Successfully repaired malformed JSON on third attempt'
          );
          done(null, json);
        } catch (finalErr) {
          // All attempts failed - log detailed error for debugging
          req.log.error(
            {
              event: 'json.parse.error',
              rawBody: rawBody.substring(0, 3000),
              rawBodyEnd: rawBody.length > 3000 ? rawBody.substring(rawBody.length - 500) : undefined,
              bodyLength: rawBody.length,
              parseError: (err as Error).message,
              repairError: (repairErr as Error).message,
              finalError: (finalErr as Error).message,
            },
            'Failed to parse JSON body after all repair attempts'
          );
          done(err as Error, undefined);
        }
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
