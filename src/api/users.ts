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
import { classifyUserSync } from '../services/user-classifier';

const requestSchema = z.object({
  user_id: z.string().min(1),
  resume_text: z.string().min(1),
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

function normalizeRequest(body: RequestBody): NormalizedUserProfile {
  const country = sanitizeOptionalString(body.country);
  return {
    userId: body.user_id,
    resumeText: truncateResumeText(body.resume_text),
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
          message: 'resume_text must not be empty',
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

      // Classify user to determine domain_expert vs general_labeler vs mixed
      const classification = classifyUserSync(normalized);
      log.info(
        {
          event: 'user.classified',
          userId: normalized.userId,
          userClass: classification.userClass,
          confidence: classification.confidence,
          credentials: classification.credentials,
          expertiseTier: classification.expertiseTier,
          hasLabelingExperience: classification.hasLabelingExperience,
        },
        'User classified for smart matching'
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

      // Build enriched metadata for Pinecone filtering
      // This enables smart matching:
      // - Specialized jobs filter by credentials/domain codes
      // - Generic jobs exclude pure domain experts (avoid spamming MDs with bounding box work)
      const userMetadata = {
        user_id: normalized.userId,
        model: EMBEDDING_MODEL,
        type: 'user' as const,
        user_class: classification.userClass,
        credentials: classification.credentials,
        domain_codes: classification.domainCodes,
        estimated_experience_years: classification.estimatedExperienceYears,
        expertise_tier: classification.expertiseTier,
        has_labeling_experience: classification.hasLabelingExperience,
        task_capabilities: classification.taskCapabilities,
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
        // Classification determines matching eligibility:
        // - domain_expert: eligible for specialized jobs, excluded from generic job spam
        // - general_labeler: eligible for generic jobs, not for specialized unless has credentials
        // - mixed: eligible for both specialized and generic jobs
        classification: {
          user_class: classification.userClass,
          confidence: classification.confidence,
          credentials: classification.credentials,
          domain_codes: classification.domainCodes,
          estimated_experience_years: classification.estimatedExperienceYears,
          expertise_tier: classification.expertiseTier,
          has_labeling_experience: classification.hasLabelingExperience,
          task_capabilities: classification.taskCapabilities,
          signals: classification.signals,
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
