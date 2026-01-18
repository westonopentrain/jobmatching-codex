import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError, toErrorResponse } from '../utils/errors';
import { sanitizeOptionalString, sanitizeStringArray, truncateResumeText, normalizeLanguages } from '../utils/sanitize';
import { ensureAuthorized } from '../utils/auth';

import { NormalizedUserProfile } from '../utils/types';
import { generateCapsules } from '../services/capsules';
import { classifyUser } from '../services/user-classifier';
import { embedText, EMBEDDING_DIMENSION, EMBEDDING_MODEL } from '../services/embeddings';
import { upsertVector, deleteVectors, updateVectorMetadata, VectorMetadata } from '../services/pinecone';
import { requireEnv } from '../utils/env';
import { auditUserUpsert } from '../services/audit';
import { getDb, isDatabaseAvailable } from '../services/db';

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

      // Classify user to extract expertise tier, credentials, subject matter codes
      const classification = await classifyUser(normalized);
      log.info(
        {
          event: 'user.classified',
          userId: normalized.userId,
          expertiseTier: classification.expertiseTier,
          credentials: classification.credentials,
          subjectMatterCodes: classification.subjectMatterCodes,
          hasLabelingExperience: classification.hasLabelingExperience,
          confidence: classification.confidence,
        },
        'User classified for smart matching'
      );

      // Fix tier misclassification: users with "general workforce" domain
      // should not be classified as specialists/experts
      const domainLower = capsules.domain.text.toLowerCase();
      if (
        (domainLower.includes('general workforce') ||
          domainLower.includes('no specialized expertise')) &&
        classification.expertiseTier !== 'entry'
      ) {
        const originalTier = classification.expertiseTier;
        classification.expertiseTier = 'entry';
        log.info(
          {
            event: 'user.tier_downgraded',
            userId: normalized.userId,
            originalTier,
            newTier: 'entry',
            reason: 'general_workforce_domain',
          },
          'Downgraded tier due to general workforce domain'
        );
      }

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

      // Normalize languages for Pinecone filtering (extracts "Slovak" from "Slovak - Proficiency Level = Native")
      const normalizedLanguagesForFilter = normalizeLanguages(normalized.languages);

      // Build enriched metadata for Pinecone filtering
      // This enables smart matching: filter/weight users by expertise, credentials, etc.
      const userMetadata = {
        user_id: normalized.userId,
        model: EMBEDDING_MODEL,
        type: 'user' as const,
        expertise_tier: classification.expertiseTier,
        credentials: classification.credentials,
        subject_matter_codes: classification.subjectMatterCodes,
        years_experience: classification.yearsExperience,
        has_labeling_experience: classification.hasLabelingExperience,
        languages: normalizedLanguagesForFilter,
        ...(normalized.country ? { country: normalized.country } : {}),
      };

      // Always upsert both vectors - skills capsule captures ALL professional skills
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
        rawInput: bodyWithAliases as Record<string, unknown>,
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
        // Classification data
        expertiseTier: classification.expertiseTier,
        credentials: classification.credentials,
        subjectMatterCodes: classification.subjectMatterCodes,
        yearsExperience: classification.yearsExperience,
        classificationConfidence: classification.confidence,
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
        // Classification determines matching behavior
        classification: {
          expertise_tier: classification.expertiseTier,
          confidence: classification.confidence,
          credentials: classification.credentials,
          subject_matter_codes: classification.subjectMatterCodes,
          years_experience: classification.yearsExperience,
          has_labeling_experience: classification.hasLabelingExperience,
          reasoning: classification.reasoning,
        },
        updated_at: now,
        elapsed_ms: elapsedRounded,
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

  // DELETE endpoint for removing users
  fastify.delete('/v1/users/:userId', async (request, reply) => {
    const log = request.log.child({ route: 'users.delete' });

    try {
      ensureAuthorized(request.headers.authorization, serviceApiKey);

      const { userId } = request.params as { userId: string };
      if (!userId || typeof userId !== 'string') {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          statusCode: 400,
          message: 'User ID is required',
        });
      }

      log.info({ event: 'users.delete.start', userId }, 'Starting user deletion');

      // Delete vectors from Pinecone
      const domainVectorId = `usr_${userId}::domain`;
      const taskVectorId = `usr_${userId}::task`;
      await deleteVectors([domainVectorId, taskVectorId]);
      log.info({ event: 'users.delete.pinecone', userId }, 'Deleted user vectors from Pinecone');

      // Delete audit records from PostgreSQL
      let auditDeleted = 0;
      if (isDatabaseAvailable()) {
        const db = getDb();
        if (db) {
          const result = await db.auditUserUpsert.deleteMany({
            where: { userId },
          });
          auditDeleted = result.count;
          log.info({ event: 'users.delete.audit', userId, count: auditDeleted }, 'Deleted user audit records');
        }
      }

      return reply.status(200).send({
        status: 'ok',
        user_id: userId,
        deleted: {
          vectors: [domainVectorId, taskVectorId],
          audit_records: auditDeleted,
        },
      });
    } catch (error) {
      if (error instanceof AppError) {
        log.warn({ error: error.message, code: error.code }, 'Handled user delete error');
        return reply.status(error.statusCode).send(toErrorResponse(error));
      }

      log.error({ err: error }, 'Unexpected error during user delete');
      const appError = new AppError({
        code: 'USER_DELETE_FAILURE',
        statusCode: 500,
        message: 'Unexpected server error',
      });
      return reply.status(appError.statusCode).send(toErrorResponse(appError));
    }
  });

  // PATCH endpoint for updating user metadata only (country, languages)
  // This is much cheaper than a full re-upsert since it skips LLM calls
  const metadataSchema = z.object({
    country: z.string().optional(),
    languages: z.array(z.string()).optional(),
  });

  fastify.patch('/v1/users/:userId/metadata', async (request, reply) => {
    const requestId = request.id as string;
    const log = request.log.child({ route: 'users.metadata', requestId });
    const startedAt = process.hrtime.bigint();

    try {
      ensureAuthorized(request.headers.authorization, serviceApiKey);

      const { userId } = request.params as { userId: string };
      if (!userId || typeof userId !== 'string') {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          statusCode: 400,
          message: 'User ID is required',
        });
      }

      const parsed = metadataSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          statusCode: 400,
          message: 'Invalid request body',
          details: { issues: parsed.error.issues },
        });
      }

      const { country, languages } = parsed.data;

      // At least one field must be provided
      if (country === undefined && languages === undefined) {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          statusCode: 400,
          message: 'At least one metadata field (country or languages) must be provided',
        });
      }

      log.info({ event: 'users.metadata.start', userId, country, languages }, 'Starting user metadata update');

      // Build metadata object to update
      const metadata: VectorMetadata = {};
      if (country !== undefined) {
        metadata.country = sanitizeOptionalString(country) ?? '';
      }
      if (languages !== undefined) {
        metadata.languages = normalizeLanguages(sanitizeStringArray(languages));
      }

      // Update both domain and task vectors
      const domainVectorId = `usr_${userId}::domain`;
      const taskVectorId = `usr_${userId}::task`;

      await updateVectorMetadata([domainVectorId, taskVectorId], metadata);

      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const elapsedRounded = Number(elapsedMs.toFixed(2));

      log.info(
        {
          event: 'users.metadata.complete',
          userId,
          updatedFields: Object.keys(metadata),
          elapsedMs: elapsedRounded,
        },
        'User metadata update completed'
      );

      return reply.status(200).send({
        status: 'ok',
        user_id: userId,
        updated_metadata: metadata,
        vectors_updated: [domainVectorId, taskVectorId],
        elapsed_ms: elapsedRounded,
      });
    } catch (error) {
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const elapsedRounded = Number(elapsedMs.toFixed(2));

      if (error instanceof AppError) {
        log.warn(
          { error: error.message, code: error.code, details: error.details, event: 'users.metadata.error', elapsedMs: elapsedRounded },
          'Handled user metadata error'
        );
        return reply.status(error.statusCode).send(toErrorResponse(error));
      }

      log.error({ err: error, event: 'users.metadata.error', elapsedMs: elapsedRounded }, 'Unexpected error during user metadata update');
      const appError = new AppError({
        code: 'USER_METADATA_FAILURE',
        statusCode: 500,
        message: 'Unexpected server error',
      });
      return reply.status(appError.statusCode).send(toErrorResponse(appError));
    }
  });
};
