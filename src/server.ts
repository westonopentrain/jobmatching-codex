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

  // Escape unescaped quotes inside JSON string values
  // This handles cases where Bubble sends: "Instructions": "...For example, "20+ hours" is..."
  // Which should be: "Instructions": "...For example, \"20+ hours\" is..."
  function escapeInnerQuotes(raw: string): string {
    const result: string[] = [];
    let i = 0;
    let inString = false;

    while (i < raw.length) {
      const char = raw[i]!;

      // Handle escape sequences
      if (char === '\\' && i + 1 < raw.length) {
        result.push(char, raw[i + 1]!);
        i += 2;
        continue;
      }

      if (char === '"') {
        if (!inString) {
          // Starting a string
          inString = true;
          result.push(char);
          i++;
        } else {
          // Potentially ending a string - look ahead to see if this is structural
          // A structural quote is followed by: , } ] : or whitespace then one of these
          let j = i + 1;
          while (j < raw.length && /\s/.test(raw[j]!)) j++;

          const nextChar = j < raw.length ? raw[j] : undefined;
          const isStructural = nextChar === ',' || nextChar === '}' || nextChar === ']' ||
                               nextChar === ':' || nextChar === undefined;

          if (isStructural) {
            // This quote ends the string
            inString = false;
            result.push(char);
            i++;
          } else {
            // This quote is inside the string - escape it
            result.push('\\', '"');
            i++;
          }
        }
      } else {
        result.push(char);
        i++;
      }
    }

    return result.join('');
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
      // Second attempt: escape inner quotes then parse
      try {
        const sanitized = sanitizeJsonString(rawBody);
        const escaped = escapeInnerQuotes(sanitized);
        const json = JSON.parse(escaped);
        req.log.info(
          {
            event: 'json.repair.escaped_quotes',
            originalLength: rawBody.length,
          },
          'Successfully parsed JSON after escaping inner quotes'
        );
        done(null, json);
      } catch (escapeErr) {
        // Third attempt: use jsonrepair for other structural issues
        try {
          const sanitized = sanitizeJsonString(rawBody);
          const escaped = escapeInnerQuotes(sanitized);
          const repaired = jsonrepair(escaped);
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
          // Fourth attempt: handle truncated JSON
          try {
            let sanitized = sanitizeJsonString(rawBody);
            sanitized = escapeInnerQuotes(sanitized);

            // Count open braces and brackets to detect truncation
            let braceCount = 0;
            let bracketCount = 0;
            let inStr = false;
            let esc = false;

            for (let i = 0; i < sanitized.length; i++) {
              const char = sanitized[i];
              if (esc) {
                esc = false;
                continue;
              }
              if (char === '\\') {
                esc = true;
                continue;
              }
              if (char === '"') {
                inStr = !inStr;
                continue;
              }
              if (!inStr) {
                if (char === '{') braceCount++;
                else if (char === '}') braceCount--;
                else if (char === '[') bracketCount++;
                else if (char === ']') bracketCount--;
              }
            }

            // If truncated, close it
            if (inStr || braceCount > 0 || bracketCount > 0) {
              if (inStr) sanitized += '"';
              while (bracketCount > 0) {
                sanitized += ']';
                bracketCount--;
              }
              while (braceCount > 0) {
                sanitized += '}';
                braceCount--;
              }
            }

            const repaired = jsonrepair(sanitized);
            const json = JSON.parse(repaired);
            req.log.info(
              {
                event: 'json.repair.truncated',
                originalLength: rawBody.length,
              },
              'Repaired truncated/malformed JSON'
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
                escapeError: (escapeErr as Error).message,
                repairError: (repairErr as Error).message,
                finalError: (finalErr as Error).message,
              },
              'Failed to parse JSON body after all repair attempts'
            );
            done(err as Error, undefined);
          }
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
