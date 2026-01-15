import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError, toErrorResponse } from '../utils/errors';
import { sanitizeOptionalString, sanitizeStringArray, truncateResumeText } from '../utils/sanitize';
import { ensureAuthorized } from '../utils/auth';

import { NormalizedUserProfile } from '../utils/types';
import { generateCapsules } from '../services/capsules';
import { embedText, EMBEDDING_DIMENSION, EMBEDDING_MODEL } from '../services/embeddings';
import { upsertVector } from '../services/pinecone';
import { requireEnv } from '../utils/env';
import { auditUserUpsert } from '../services/audit';

const requestSchema = z.object({
  user_id: z.string().min(1),
  resume_text: z.string().optional(),
  work_experience: z.array(z.string()).optional(),
  education: z.array(z.string()).optional(),
  labeling_experience: z.array(z.string()).optional(),
  country: z.string().optional(),
  languages: z.array(z.string()).optional(),
});

type RequestBody = z.infer<typeof requestSchema>;

function applyAliases(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const record = { ...(payload as Record<string, unknown>) };

  if (record.label_experience !== undefined && record.labeling_experience === undefined) {
    record.labeling_experience = record.label_experience;
  }

  if (record.language !== undefined && record.languages === undefined) {
    const value = record.language;
    if (typeof value === 'string') {
      record.languages = [value];
    } else if (Array.isArray(value)) {
      record.languages = value;
    }
  }

  return record;
}

function buildResumeText(body: RequestBody): string {
  // Use resume_text if provided
  if (body.resume_text && body.resume_text.trim().length > 0) {
    return truncateResumeText(body.resume_text);
  }

  // Build from other available fields
  const parts: string[] = [];

  if (body.work_experience) {
    const work = body.work_experience.filter((s) => s && s.trim().length > 0);
    if (work.length > 0) {
      parts.push('Work Experience: ' + work.join('; '));
    }
  }

  if (body.education) {
    const edu = body.education.filter((s) => s && s.trim().length > 0);
    if (edu.length > 0) {
      parts.push('Education: ' + edu.join('; '));
    }
  }

  if (body.labeling_experience) {
    const labeling = body.labeling_experience.filter((s) => s && s.trim().length > 0);
    if (labeling.length > 0) {
      parts.push('Labeling Experience: ' + labeling.join('; '));
    }
  }

  return truncateResumeText(parts.join('\n\n'));
}

function normalizeRequest(body: RequestBody): NormalizedUserProfile {
  const country = sanitizeOptionalString(body.country);
  return {
    userId: body.user_id,
    resumeText: buildResumeText(body),
    workExperience: sanitizeStringArray(body.work_experience),
    education: sanitizeStringArray(body.education),
    labelingExperience: sanitizeStringArray(body.labeling_experience),
    languages: sanitizeStringArray(body.languages),
    ...(country ? { country } : {}),
  };
}

export const userRoutes: FastifyPluginAsync = async (fastify) => {
  const serviceApiKey = requireEnv('SERVICE_API_KEY');

  fastify.post('/v1/users/upsert', async (request, reply) => {
    const requestId = request.id as string;
    const log = request.log.child({ route: 'users.upsert', requestId });
    const startedAt = process.hrtime.bigint();

    log.info({ event: 'upsert.start' }, 'Starting user capsule upsert');

    try {
      ensureAuthorized(request.headers.authorization, serviceApiKey);

      const bodyWithAliases = applyAliases(request.body);
      const parsed = requestSchema.safeParse(bodyWithAliases);
      if (!parsed.success) {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          statusCode: 400,
          message: 'Invalid request body',
          details: { issues: parsed.error.issues },
        });
      }

      const normalized = normalizeRequest(parsed.data);
      if (normalized.resumeText.length === 0) {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          statusCode: 400,
          message: 'No profile data provided. Please include resume_text, work_experience, education, or labeling_experience.',
        });
      }

      const capsules = await generateCapsules(normalized);
      log.info(
        {
          event: 'capsules.generated',
          userId: normalized.userId,
          domainChars: capsules.domain.text.length,
          taskChars: capsules.task.text.length,
        },
        'Capsules generated successfully'
      );

      const domainVectorId = `usr_${normalized.userId}::domain`;
      const taskVectorId = `usr_${normalized.userId}::task`;

      const [domainEmbedding, taskEmbedding] = await Promise.all([
        embedText(capsules.domain.text),
        embedText(capsules.task.text),
      ]);

      log.info(
        {
          event: 'embeddings.generated',
          userId: normalized.userId,
          model: EMBEDDING_MODEL,
        },
        'Embeddings generated successfully'
      );

      const userMetadata = {
        user_id: normalized.userId,
        model: EMBEDDING_MODEL,
        type: 'user' as const,
        languages: normalized.languages,
        ...(normalized.country ? { country: normalized.country } : {}),
      };

      await upsertVector(domainVectorId, domainEmbedding, {
        ...userMetadata,
        section: 'domain' as const,
      });

      await upsertVector(taskVectorId, taskEmbedding, {
        ...userMetadata,
        section: 'task' as const,
      });

      log.info(
        {
          event: 'pinecone.upsert',
          userId: normalized.userId,
          domainVectorId,
          taskVectorId,
        },
        'Pinecone upsert completed'
      );

      const now = new Date().toISOString();
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const elapsedRounded = Number(elapsedMs.toFixed(2));
      log.info(
        {
          event: 'upsert.complete',
          userId: normalized.userId,
          domainChars: capsules.domain.text.length,
          taskChars: capsules.task.text.length,
          resumeChars: normalized.resumeText.length,
          elapsedMs: elapsedRounded,
        },
        'User capsule upsert completed'
      );

      // Audit logging (non-blocking)
      auditUserUpsert({
        userId: normalized.userId,
        requestId,
        resumeChars: normalized.resumeText.length,
        hasWorkExperience: (normalized.workExperience?.length ?? 0) > 0,
        hasEducation: (normalized.education?.length ?? 0) > 0,
        hasLabelingExperience: (normalized.labelingExperience?.length ?? 0) > 0,
        country: normalized.country,
        languages: normalized.languages,
        domainCapsule: capsules.domain.text,
        taskCapsule: capsules.task.text,
        evidenceDetected: !capsules.task.text.includes('No AI/LLM data-labeling'),
        elapsedMs: elapsedRounded,
      });

      return reply.status(200).send({
        status: 'ok',
        user_id: normalized.userId,
        embedding_model: EMBEDDING_MODEL,
        dimension: EMBEDDING_DIMENSION,
        domain: {
          vector_id: domainVectorId,
          capsule_text: capsules.domain.text,
          chars: capsules.domain.text.length,
        },
        task: {
          vector_id: taskVectorId,
          capsule_text: capsules.task.text,
          chars: capsules.task.text.length,
        },
        updated_at: now,
      });
    } catch (error) {
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const elapsedRounded = Number(elapsedMs.toFixed(2));
      if (error instanceof AppError) {
        log.warn(
          { error: error.message, code: error.code, details: error.details, event: 'upsert.error', elapsedMs: elapsedRounded },
          'Handled application error during upsert'
        );
        return reply.status(error.statusCode).send(toErrorResponse(error));
      }

      log.error({ err: error, event: 'upsert.error', elapsedMs: elapsedRounded }, 'Unexpected error during upsert');
      const appError = new AppError({
        code: 'UPSERT_FAILURE',
        statusCode: 500,
        message: 'Unexpected server error',
      });
      return reply.status(appError.statusCode).send(toErrorResponse(appError));
    }
  });
};
