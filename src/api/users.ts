import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError, toErrorResponse } from '../utils/errors';
import { sanitizeOptionalString, sanitizeStringArray, truncateResumeText, normalizeLanguages } from '../utils/sanitize';
import { ensureAuthorized } from '../utils/auth';

import { NormalizedUserProfile } from '../utils/types';
import { generateCapsules } from '../services/capsules';
import { classifyUser } from '../services/user-classifier';
import { embedText, EMBEDDING_DIMENSION, EMBEDDING_MODEL } from '../services/embeddings';
import { upsertVector, deleteVectors, updateVectorMetadata, VectorMetadata, fetchVectors, queryByVector } from '../services/pinecone';
import { requireEnv, getEnv } from '../utils/env';
import { auditUserUpsert, auditUserMetadataUpdate } from '../services/audit';
import { getDb, isDatabaseAvailable } from '../services/db';
import { getUserQualifications, getActiveJobs, storeUserQualificationsForJobs } from '../services/qualifications';
import { getWeightProfile, JobClass } from '../services/job-classifier';
import { logger } from '../utils/logger';

const requestSchema = z.object({
  user_id: z.string().min(1),
  source: z.string().nullable().optional(), // 'manual', 'scheduled_content', 'scheduled_metadata', 'bulk_import'
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

// Thresholds matching jobs.ts - base thresholds for async evaluation
const MIN_THRESHOLD_SPECIALIZED = 0.35;
const MIN_THRESHOLD_GENERIC = 0.25;

function getBaseMinThreshold(jobClass: JobClass): number {
  return jobClass === 'specialized' ? MIN_THRESHOLD_SPECIALIZED : MIN_THRESHOLD_GENERIC;
}

// Tier-adjusted thresholds for recommended-jobs endpoint (matching score_jobs_for_user)
// These are stricter to ensure high-quality recommendations
const RECOMMENDED_MIN_SPECIALIZED = 0.50; // 50% for specialized jobs
const RECOMMENDED_MIN_GENERIC = 0.35; // 35% for generic jobs

// Tier-based threshold multipliers for generic jobs
// Specialists need higher scores to match generic jobs (they should focus on specialized work)
const TIER_THRESHOLD_MULTIPLIERS: Record<string, number> = {
  'specialist': 1.3, // 45% for generic (35% * 1.3)
  'expert': 1.15, // ~40% for generic
  'intermediate': 1.0,
  'entry': 1.0,
};

function getTierAdjustedMinThreshold(
  userTier: string | undefined,
  jobClass: JobClass
): number {
  const baseMin = jobClass === 'specialized' ? RECOMMENDED_MIN_SPECIALIZED : RECOMMENDED_MIN_GENERIC;
  const multiplier = TIER_THRESHOLD_MULTIPLIERS[userTier ?? 'entry'] ?? 1.0;

  // Only apply multiplier to generic jobs - specialists shouldn't see irrelevant generic jobs
  return jobClass === 'generic' ? baseMin * multiplier : baseMin;
}

/**
 * Async re-evaluation of user against all active jobs
 * Called after user profile update to populate "Recommended Jobs" data
 * This is non-blocking and runs in the background
 */
async function evaluateUserAgainstActiveJobs(
  userId: string,
  userDomainEmbedding: number[],
  userTaskEmbedding: number[]
): Promise<void> {
  try {
    // Get all active jobs
    const activeJobs = await getActiveJobs();
    if (activeJobs.length === 0) {
      logger.info(
        { event: 'user.evaluate.no_active_jobs', userId },
        'No active jobs to evaluate user against'
      );
      return;
    }

    logger.info(
      { event: 'user.evaluate.start', userId, jobCount: activeJobs.length },
      'Starting async evaluation of user against active jobs'
    );

    const results: Array<{
      jobId: string;
      qualifies: boolean;
      finalScore: number;
      domainScore: number;
      taskScore: number;
      thresholdUsed: number;
      filterReason: string | null;
    }> = [];

    // Evaluate user against each job
    for (const job of activeJobs) {
      try {
        const domainVectorId = `job_${job.id}::domain`;
        const taskVectorId = `job_${job.id}::task`;

        const vectors = await fetchVectors([domainVectorId, taskVectorId]);
        if (!vectors[domainVectorId] || !vectors[taskVectorId]) {
          // Job vectors not found, skip
          continue;
        }

        const jobDomainVector = vectors[domainVectorId].values;
        const jobTaskVector = vectors[taskVectorId].values;
        const jobMetadata = vectors[domainVectorId].metadata as Record<string, unknown> | undefined;
        const jobClass = (jobMetadata?.job_class as JobClass) ?? 'generic';

        if (!jobDomainVector || !jobTaskVector) {
          continue;
        }

        // Calculate cosine similarity scores
        // Domain score: similarity between user domain and job domain
        const domainScore = cosineSimilarity(userDomainEmbedding, jobDomainVector);
        // Task score: similarity between user task and job task
        const taskScore = cosineSimilarity(userTaskEmbedding, jobTaskVector);

        // Calculate final score using job class weights
        const weights = getWeightProfile(jobClass);
        const finalScore = weights.w_domain * domainScore + weights.w_task * taskScore;

        const threshold = getBaseMinThreshold(jobClass);
        const qualifies = finalScore >= threshold;

        results.push({
          jobId: job.id,
          qualifies,
          finalScore,
          domainScore,
          taskScore,
          thresholdUsed: threshold,
          filterReason: qualifies ? null : `below_threshold (${(threshold * 100).toFixed(0)}%)`,
        });
      } catch (jobError) {
        logger.warn(
          { event: 'user.evaluate.job_error', userId, jobId: job.id, error: jobError },
          'Failed to evaluate user against job'
        );
      }
    }

    // Store results
    if (results.length > 0) {
      const { stored, errors } = await storeUserQualificationsForJobs(userId, results);
      logger.info(
        { event: 'user.evaluate.complete', userId, evaluated: results.length, stored, errors },
        'Completed async evaluation of user against active jobs'
      );
    }
  } catch (error) {
    logger.error(
      { event: 'user.evaluate.error', userId, error },
      'Failed to evaluate user against active jobs'
    );
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const aVal = a[i]!;
    const bVal = b[i]!;
    dotProduct += aVal * bVal;
    normA += aVal * aVal;
    normB += bVal * bVal;
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
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

      // Async re-evaluation against active jobs (non-blocking)
      // This populates the "Recommended Jobs" data for the user
      evaluateUserAgainstActiveJobs(normalized.userId, domainEmbedding, taskEmbedding).catch(
        (err) => log.error({ err, event: 'user.async_eval.error' }, 'Async job evaluation failed')
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
        source: parsed.data.source ?? undefined,
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
    source: z.string().nullable().optional(), // 'manual', 'scheduled_metadata', 'bulk_import'
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

      const { source, country, languages } = parsed.data;

      // At least one field must be provided
      if (country === undefined && languages === undefined) {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          statusCode: 400,
          message: 'At least one metadata field (country or languages) must be provided',
        });
      }

      log.info({ event: 'users.metadata.start', userId, source, country, languages }, 'Starting user metadata update');

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
          source,
          updatedFields: Object.keys(metadata),
          elapsedMs: elapsedRounded,
        },
        'User metadata update completed'
      );

      // Audit logging (non-blocking)
      auditUserMetadataUpdate({
        userId,
        requestId,
        source: source ?? undefined,
        country,
        languages,
        elapsedMs: elapsedRounded,
      });

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

  // GET endpoint for user qualifications across all jobs
  fastify.get('/v1/users/:userId/qualifications', async (request, reply) => {
    const log = request.log.child({ route: 'users.qualifications' });

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

      const { active_jobs_only, qualifies_only, limit, offset } = request.query as {
        active_jobs_only?: string;
        qualifies_only?: string;
        limit?: string;
        offset?: string;
      };

      const userQualOptions: { activeJobsOnly?: boolean; qualifiesOnly?: boolean; limit?: number; offset?: number } = {};
      if (active_jobs_only === 'true') userQualOptions.activeJobsOnly = true;
      if (qualifies_only === 'true') userQualOptions.qualifiesOnly = true;
      if (limit) userQualOptions.limit = parseInt(limit, 10);
      if (offset) userQualOptions.offset = parseInt(offset, 10);
      const { qualifications, total } = await getUserQualifications(userId, userQualOptions);

      log.info(
        { event: 'users.qualifications.query', userId, count: qualifications.length, total },
        'Queried user qualifications'
      );

      return reply.status(200).send({
        user_id: userId,
        count: qualifications.length,
        total,
        qualifications: qualifications.map((q) => ({
          job_id: q.jobId,
          job_active: q.jobActive,
          qualifies: q.qualifies,
          final_score: q.finalScore,
          domain_score: q.domainScore,
          task_score: q.taskScore,
          threshold_used: q.thresholdUsed,
          filter_reason: q.filterReason,
          notified_at: q.notifiedAt,
          notified_via: q.notifiedVia,
          evaluated_at: q.evaluatedAt,
        })),
      });
    } catch (error) {
      if (error instanceof AppError) {
        log.warn({ error: error.message, code: error.code }, 'Handled user qualifications error');
        return reply.status(error.statusCode).send(toErrorResponse(error));
      }

      log.error({ err: error }, 'Unexpected error during user qualifications query');
      const appError = new AppError({
        code: 'USER_QUALIFICATIONS_FAILURE',
        statusCode: 500,
        message: 'Unexpected server error',
      });
      return reply.status(appError.statusCode).send(toErrorResponse(appError));
    }
  });

  // GET endpoint for recommended jobs for a user
  // Returns job IDs pre-filtered by tier-adjusted thresholds and sorted by score
  // This simplifies Bubble integration - just map job_ids to Jobs
  fastify.get('/v1/users/:userId/recommended-jobs', async (request, reply) => {
    const requestId = request.id as string;
    const log = request.log.child({ route: 'users.recommended_jobs', requestId });
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

      const { limit: limitParam } = request.query as { limit?: string };
      const limit = limitParam ? parseInt(limitParam, 10) : undefined;

      log.info({ event: 'users.recommended_jobs.start', userId, limit }, 'Starting recommended jobs query');

      // Fetch user vectors
      const userDomainVectorId = `usr_${userId}::domain`;
      const userTaskVectorId = `usr_${userId}::task`;

      const userVectors = await fetchVectors([userDomainVectorId, userTaskVectorId]);
      const userDomainVector = userVectors[userDomainVectorId]?.values;
      const userTaskVector = userVectors[userTaskVectorId]?.values;

      if (!userDomainVector || !userTaskVector || userDomainVector.length === 0 || userTaskVector.length === 0) {
        throw new AppError({
          code: 'USER_VECTORS_MISSING',
          statusCode: 404,
          message: 'User vectors not found; upsert user first via /v1/users/upsert.',
        });
      }

      // Get user metadata (expertise tier, country, languages)
      const userMetadata = userVectors[userDomainVectorId]?.metadata as Record<string, unknown> | undefined;
      const userExpertiseTier = (userMetadata?.expertise_tier as string | undefined) ?? undefined;
      const userCountry = (userMetadata?.country as string | undefined) ?? undefined;
      const userLanguages = (userMetadata?.languages as string[] | undefined) ?? [];

      // Get all active jobs
      const activeJobs = await getActiveJobs();
      if (activeJobs.length === 0) {
        log.info({ event: 'users.recommended_jobs.no_jobs', userId }, 'No active jobs found');
        return reply.status(200).send({
          user_id: userId,
          user_expertise_tier: userExpertiseTier,
          count: 0,
          job_ids: [],
          jobs: [],
        });
      }

      // Fetch all job vectors
      const jobVectorIds = activeJobs.flatMap((job) => [
        `job_${job.id}::domain`,
        `job_${job.id}::task`,
      ]);

      const jobVectors = await fetchVectors(jobVectorIds);

      // Score each job against the user
      const jobScores: Array<{
        jobId: string;
        jobClass: JobClass;
        finalScore: number;
        domainScore: number;
        taskScore: number;
        threshold: number;
        aboveThreshold: boolean;
      }> = [];

      let skippedByCountry = 0;
      let skippedByLanguage = 0;
      let skippedNoVectors = 0;

      for (const job of activeJobs) {
        const domainVectorId = `job_${job.id}::domain`;
        const taskVectorId = `job_${job.id}::task`;

        const jobDomainVector = jobVectors[domainVectorId]?.values;
        const jobTaskVector = jobVectors[taskVectorId]?.values;

        if (!jobDomainVector || !jobTaskVector || jobDomainVector.length === 0 || jobTaskVector.length === 0) {
          // Skip jobs without vectors
          skippedNoVectors++;
          continue;
        }

        // Get job classification and requirements from metadata
        const jobMetadata = jobVectors[domainVectorId]?.metadata as Record<string, unknown> | undefined;
        const jobClass = (jobMetadata?.job_class as JobClass | undefined) ?? 'generic';
        const jobCountries = (jobMetadata?.countries as string[] | undefined) ?? [];
        const jobLanguages = (jobMetadata?.languages as string[] | undefined) ?? [];

        // Country filter: if job has country requirements, user must be in one of them
        if (jobCountries.length > 0) {
          if (!userCountry) {
            // Job requires specific countries but user has no country set - skip
            skippedByCountry++;
            continue;
          }
          const userCountryLower = userCountry.toLowerCase();
          const matchesCountry = jobCountries.some(
            (c) => c.toLowerCase() === userCountryLower
          );
          if (!matchesCountry) {
            // User's country doesn't match job's requirements - skip
            skippedByCountry++;
            continue;
          }
        }

        // Language filter: if job has language requirements, user must speak at least one
        if (jobLanguages.length > 0) {
          if (userLanguages.length === 0) {
            // Job requires specific languages but user has none set - skip
            skippedByLanguage++;
            continue;
          }
          const userLanguagesLower = new Set(userLanguages.map((l) => l.toLowerCase()));
          const matchesLanguage = jobLanguages.some(
            (l) => userLanguagesLower.has(l.toLowerCase())
          );
          if (!matchesLanguage) {
            // User doesn't speak any of the job's required languages - skip
            skippedByLanguage++;
            continue;
          }
        }

        // Calculate cosine similarity scores
        const domainScore = cosineSimilarity(userDomainVector, jobDomainVector);
        const taskScore = cosineSimilarity(userTaskVector, jobTaskVector);

        // Calculate final score using job class weights
        const weights = getWeightProfile(jobClass);
        const finalScore = weights.w_domain * domainScore + weights.w_task * taskScore;

        // Get tier-adjusted threshold for this job
        const threshold = getTierAdjustedMinThreshold(userExpertiseTier, jobClass);
        const aboveThreshold = finalScore >= threshold;

        jobScores.push({
          jobId: job.id,
          jobClass,
          finalScore,
          domainScore,
          taskScore,
          threshold,
          aboveThreshold,
        });
      }

      // Filter to only jobs above threshold and sort by final score descending
      const recommendedJobs = jobScores
        .filter((j) => j.aboveThreshold)
        .sort((a, b) => b.finalScore - a.finalScore);

      // Apply limit if specified
      const limitedJobs = limit ? recommendedJobs.slice(0, limit) : recommendedJobs;

      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const elapsedRounded = Number(elapsedMs.toFixed(2));

      log.info(
        {
          event: 'users.recommended_jobs.complete',
          userId,
          userTier: userExpertiseTier,
          userCountry,
          userLanguages,
          activeJobs: activeJobs.length,
          skippedByCountry,
          skippedByLanguage,
          skippedNoVectors,
          scoredJobs: jobScores.length,
          aboveThreshold: recommendedJobs.length,
          recommendedJobs: limitedJobs.length,
          elapsedMs: elapsedRounded,
        },
        'Completed recommended jobs query'
      );

      // Round scores for response
      const roundScore = (n: number) => Math.round(n * 10000) / 10000;

      return reply.status(200).send({
        user_id: userId,
        user_expertise_tier: userExpertiseTier,
        user_country: userCountry ?? null,
        user_languages: userLanguages,
        count: limitedJobs.length,
        total_above_threshold: recommendedJobs.length,
        // Filtering stats for debugging
        filtering: {
          active_jobs: activeJobs.length,
          skipped_by_country: skippedByCountry,
          skipped_by_language: skippedByLanguage,
          skipped_no_vectors: skippedNoVectors,
          scored: jobScores.length,
          below_threshold: jobScores.length - recommendedJobs.length,
        },
        // Simple job_ids list for easy Bubble integration
        job_ids: limitedJobs.map((j) => j.jobId),
        // Detailed jobs list with scores
        jobs: limitedJobs.map((j, idx) => ({
          job_id: j.jobId,
          rank: idx + 1,
          job_class: j.jobClass,
          final_score: roundScore(j.finalScore),
          domain_score: roundScore(j.domainScore),
          task_score: roundScore(j.taskScore),
          threshold_used: roundScore(j.threshold),
        })),
        elapsed_ms: elapsedRounded,
      });
    } catch (error) {
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const elapsedRounded = Number(elapsedMs.toFixed(2));

      if (error instanceof AppError) {
        log.warn(
          { error: error.message, code: error.code, details: error.details, event: 'users.recommended_jobs.error', elapsedMs: elapsedRounded },
          'Handled recommended jobs error'
        );
        return reply.status(error.statusCode).send(toErrorResponse(error));
      }

      log.error({ err: error, event: 'users.recommended_jobs.error', elapsedMs: elapsedRounded }, 'Unexpected error during recommended jobs query');
      const appError = new AppError({
        code: 'USER_RECOMMENDED_JOBS_FAILURE',
        statusCode: 500,
        message: 'Unexpected server error',
      });
      return reply.status(appError.statusCode).send(toErrorResponse(appError));
    }
  });
};
