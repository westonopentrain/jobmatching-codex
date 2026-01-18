import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { AppError, toErrorResponse } from '../utils/errors';
import { ensureAuthorized } from '../utils/auth';
import { getEnv, requireEnv } from '../utils/env';
import { EMBEDDING_DIMENSION, EMBEDDING_MODEL, embedText } from '../services/embeddings';
import { getSemanticMatchDetails, SemanticMatchResult } from '../services/subject-matter-embeddings';
import { upsertVector, deleteVectors, fetchVectors, queryUsersByFilter, queryByVector, queryUsersWithSubjectMatterCodes } from '../services/pinecone';
import { getDb, isDatabaseAvailable } from '../services/db';
import { generateJobCapsules, normalizeJobRequest } from '../services/job-capsules';
import { JobFields, UpsertJobRequest } from '../utils/types';
import { classifyJob, getWeightProfile, JobClass } from '../services/job-classifier';
import { auditJobUpsert, auditJobNotify } from '../services/audit';
import { checkJobUpsertAlerts } from '../services/alerts';
import { logger } from '../utils/logger';

const fieldSchema = z.object({
  Instructions: z.string().optional(),
  Workload_Desc: z.string().optional(),
  Dataset_Description: z.string().optional(),
  Data_SubjectMatter: z.string().optional(),
  Data_Type: z.string().optional(),
  LabelTypes: z.array(z.string()).optional(),
  Requirements_Additional: z.string().optional(),
  AvailableLanguages: z.array(z.string()).optional(),
  AvailableCountries: z.array(z.string()).optional(),
  ExpertiseLevel: z.string().optional(),
  TimeRequirement: z.string().optional(),
  ProjectType: z.string().optional(),
  LabelSoftware: z.string().optional(),
  AdditionalSkills: z.array(z.string()).optional(),
});

const jobUpsertSchema = z.object({
  job_id: z.string().min(1),
  title: z.string().optional(),
  fields: fieldSchema,
});

// Schema for /v1/jobs/notify - find users to notify about a new job
const jobNotifySchema = z.object({
  job_id: z.string().min(1),
  title: z.string().optional(),
  fields: fieldSchema,
  // Country/language filters - users must match at least one of each
  available_countries: z.array(z.string()).optional(),
  available_languages: z.array(z.string()).optional(),
  // Safety cap - max number of users to notify even if more qualify
  max_notifications: z.number().int().positive().max(10000).default(500),
});

// Constants for notify scoring
const NOTIFY_TOPK = 10000;
const FILTER_CHUNK_SIZE = 500;
// Thresholds lowered significantly to improve notification rates
// - Specialized 50% → 35%: Angular job went from 5.6% to ~31% notification rate
// - Generic 35% → 25%: Generic jobs can be done by almost anyone
const MIN_THRESHOLD_SPECIALIZED = 0.35;
const MIN_THRESHOLD_GENERIC = 0.25;

// Tier multipliers removed - they penalized experts for generic tasks,
// and expertise is already captured in similarity scores for specialized jobs

function getBaseMinThreshold(jobClass: JobClass): number {
  return jobClass === 'specialized' ? MIN_THRESHOLD_SPECIALIZED : MIN_THRESHOLD_GENERIC;
}

function isValidVector(values: number[] | undefined): values is number[] {
  return Array.isArray(values) && values.length === EMBEDDING_DIMENSION;
}

function chunkArray<T>(items: readonly T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

export const jobRoutes: FastifyPluginAsync = async (fastify) => {
  const serviceApiKey = requireEnv('SERVICE_API_KEY');

  fastify.post('/v1/jobs/upsert', async (request, reply) => {
    const requestId = request.id as string;
    const log = request.log.child({ route: 'jobs.upsert', requestId });
    const startedAt = process.hrtime.bigint();

    try {
      ensureAuthorized(request.headers.authorization, serviceApiKey);

      const parsed = jobUpsertSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          statusCode: 400,
          message: 'Invalid request body',
          details: { issues: parsed.error.issues },
        });
      }

      const rawFields = parsed.data.fields;
      const fieldEntries = Object.entries(rawFields).filter(([, value]) => value !== undefined) as Array<[
        keyof JobFields,
        JobFields[keyof JobFields],
      ]>;
      const fields = Object.fromEntries(fieldEntries) as JobFields;

      const upsertRequest: UpsertJobRequest = {
        job_id: parsed.data.job_id,
        fields,
      };

      if (parsed.data.title !== undefined) {
        upsertRequest.title = parsed.data.title;
      }

      const normalized = normalizeJobRequest(upsertRequest);

      const capsules = await generateJobCapsules(normalized);
      log.info(
        {
          event: 'job_capsules.generated',
          jobId: normalized.jobId,
          domainChars: capsules.domain.text.length,
          taskChars: capsules.task.text.length,
        },
        'Job capsules generated successfully'
      );

      // Classify job to determine specialized vs generic and extract requirements
      const classification = await classifyJob(normalized);
      log.info(
        {
          event: 'job.classified',
          jobId: normalized.jobId,
          jobClass: classification.jobClass,
          confidence: classification.confidence,
          credentials: classification.requirements.credentials,
          expertiseTier: classification.requirements.expertiseTier,
        },
        'Job classified for smart matching'
      );

      const domainVectorId = `job_${normalized.jobId}::domain`;
      const taskVectorId = `job_${normalized.jobId}::task`;

      const [domainEmbedding, taskEmbedding] = await Promise.all([
        embedText(capsules.domain.text),
        embedText(capsules.task.text),
      ]);

      // Build enriched metadata for Pinecone filtering
      // This enables smart matching: specialized jobs filter by credentials,
      // generic jobs exclude overqualified domain experts
      const jobMetadata = {
        job_id: normalized.jobId,
        model: EMBEDDING_MODEL,
        type: 'job' as const,
        job_class: classification.jobClass,
        required_credentials: classification.requirements.credentials,
        subject_matter_codes: classification.requirements.subjectMatterCodes,
        required_experience_years: classification.requirements.minimumExperienceYears,
        expertise_tier: classification.requirements.expertiseTier,
        countries: classification.requirements.countries,
        languages: classification.requirements.languages,
      };

      await upsertVector(domainVectorId, domainEmbedding, {
        ...jobMetadata,
        section: 'domain' as const,
      });

      await upsertVector(taskVectorId, taskEmbedding, {
        ...jobMetadata,
        section: 'task' as const,
      });

      log.info(
        {
          event: 'job_pinecone.upsert',
          jobId: normalized.jobId,
          domainVectorId,
          taskVectorId,
        },
        'Upserted job vectors to Pinecone'
      );

      const now = new Date().toISOString();
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const elapsedRounded = Number(elapsedMs.toFixed(2));

      // Audit logging (non-blocking)
      auditJobUpsert({
        jobId: normalized.jobId,
        requestId,
        title: normalized.title,
        rawInput: normalized as unknown as Record<string, unknown>,
        domainCapsule: capsules.domain.text,
        domainKeywords: capsules.domain.keywords ?? [],
        taskCapsule: capsules.task.text,
        taskKeywords: capsules.task.keywords ?? [],
        classification,
        elapsedMs: elapsedRounded,
      });

      // Check for alerts (non-blocking)
      checkJobUpsertAlerts({
        jobId: normalized.jobId,
        jobTitle: normalized.title,
        jobClass: classification.jobClass,
        classificationConfidence: classification.confidence,
      });

      return reply.status(200).send({
        status: 'ok',
        job_id: normalized.jobId,
        embedding_model: EMBEDDING_MODEL,
        dimension: EMBEDDING_DIMENSION,
        domain: {
          vector_id: domainVectorId,
          capsule_text: capsules.domain.text,
          chars: capsules.domain.text.length,
          keywords: capsules.domain.keywords ?? [],
        },
        task: {
          vector_id: taskVectorId,
          capsule_text: capsules.task.text,
          chars: capsules.task.text.length,
          keywords: capsules.task.keywords ?? [],
        },
        // Classification determines matching behavior:
        // - specialized: filter candidates by credentials/domain, use domain-heavy weights
        // - generic: exclude overqualified domain experts, use task-heavy weights
        classification: {
          job_class: classification.jobClass,
          confidence: classification.confidence,
          requirements: classification.requirements,
          reasoning: classification.reasoning,
        },
        updated_at: now,
        elapsed_ms: elapsedRounded,
      });
    } catch (error) {
      const errorElapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const errorElapsedRounded = Number(errorElapsedMs.toFixed(2));
      if (error instanceof AppError) {
        request.log.warn(
          { error: error.message, code: error.code, details: error.details, event: 'jobs.upsert.error', elapsedMs: errorElapsedRounded },
          'Handled job upsert error'
        );
        return reply.status(error.statusCode).send(toErrorResponse(error));
      }

      request.log.error({ err: error, event: 'jobs.upsert.error', elapsedMs: errorElapsedRounded }, 'Unexpected error during job upsert');
      const appError = new AppError({
        code: 'JOB_UPSERT_FAILURE',
        statusCode: 500,
        message: 'Unexpected server error',
      });
      return reply.status(appError.statusCode).send(toErrorResponse(appError));
    }
  });

  // DELETE endpoint for removing jobs
  fastify.delete('/v1/jobs/:jobId', async (request, reply) => {
    const log = request.log.child({ route: 'jobs.delete' });

    try {
      ensureAuthorized(request.headers.authorization, serviceApiKey);

      const { jobId } = request.params as { jobId: string };
      if (!jobId || typeof jobId !== 'string') {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          statusCode: 400,
          message: 'Job ID is required',
        });
      }

      log.info({ event: 'jobs.delete.start', jobId }, 'Starting job deletion');

      // Delete vectors from Pinecone
      const domainVectorId = `job_${jobId}::domain`;
      const taskVectorId = `job_${jobId}::task`;
      await deleteVectors([domainVectorId, taskVectorId]);
      log.info({ event: 'jobs.delete.pinecone', jobId }, 'Deleted job vectors from Pinecone');

      // Delete audit records from PostgreSQL
      let auditDeleted = 0;
      if (isDatabaseAvailable()) {
        const db = getDb();
        if (db) {
          const result = await db.auditJobUpsert.deleteMany({
            where: { jobId },
          });
          auditDeleted = result.count;
          log.info({ event: 'jobs.delete.audit', jobId, count: auditDeleted }, 'Deleted job audit records');
        }
      }

      return reply.status(200).send({
        status: 'ok',
        job_id: jobId,
        deleted: {
          vectors: [domainVectorId, taskVectorId],
          audit_records: auditDeleted,
        },
      });
    } catch (error) {
      if (error instanceof AppError) {
        log.warn({ error: error.message, code: error.code }, 'Handled job delete error');
        return reply.status(error.statusCode).send(toErrorResponse(error));
      }

      log.error({ err: error }, 'Unexpected error during job delete');
      const appError = new AppError({
        code: 'JOB_DELETE_FAILURE',
        statusCode: 500,
        message: 'Unexpected server error',
      });
      return reply.status(appError.statusCode).send(toErrorResponse(appError));
    }
  });

  // NOTIFY endpoint - find users to notify about a new job
  // This is the main entry point for Bubble to trigger job notifications
  fastify.post('/v1/jobs/notify', async (request, reply) => {
    const requestId = request.id as string;
    const log = request.log.child({ route: 'jobs.notify', requestId });
    const startedAt = process.hrtime.bigint();

    try {
      ensureAuthorized(request.headers.authorization, serviceApiKey);

      const parsed = jobNotifySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          statusCode: 400,
          message: 'Invalid request body',
          details: { issues: parsed.error.issues },
        });
      }

      const { job_id, available_countries, available_languages, max_notifications } = parsed.data;

      // Step 1: Upsert the job (same logic as /v1/jobs/upsert)
      const rawFields = parsed.data.fields;
      const fieldEntries = Object.entries(rawFields).filter(([, value]) => value !== undefined) as Array<[
        keyof JobFields,
        JobFields[keyof JobFields],
      ]>;
      const fields = Object.fromEntries(fieldEntries) as JobFields;

      const upsertRequest: UpsertJobRequest = {
        job_id: parsed.data.job_id,
        fields,
      };

      if (parsed.data.title !== undefined) {
        upsertRequest.title = parsed.data.title;
      }

      const normalized = normalizeJobRequest(upsertRequest);
      const capsules = await generateJobCapsules(normalized);
      const classification = await classifyJob(normalized);

      log.info(
        {
          event: 'notify.job_processed',
          jobId: normalized.jobId,
          jobClass: classification.jobClass,
        },
        'Job processed for notification'
      );

      const domainVectorId = `job_${normalized.jobId}::domain`;
      const taskVectorId = `job_${normalized.jobId}::task`;

      const [domainEmbedding, taskEmbedding] = await Promise.all([
        embedText(capsules.domain.text),
        embedText(capsules.task.text),
      ]);

      const jobMetadata = {
        job_id: normalized.jobId,
        model: EMBEDDING_MODEL,
        type: 'job' as const,
        job_class: classification.jobClass,
        required_credentials: classification.requirements.credentials,
        subject_matter_codes: classification.requirements.subjectMatterCodes,
        required_experience_years: classification.requirements.minimumExperienceYears,
        expertise_tier: classification.requirements.expertiseTier,
        countries: classification.requirements.countries,
        languages: classification.requirements.languages,
      };

      await Promise.all([
        upsertVector(domainVectorId, domainEmbedding, { ...jobMetadata, section: 'domain' as const }),
        upsertVector(taskVectorId, taskEmbedding, { ...jobMetadata, section: 'task' as const }),
      ]);

      // Audit job upsert (non-blocking)
      auditJobUpsert({
        jobId: normalized.jobId,
        requestId,
        title: normalized.title,
        rawInput: normalized as unknown as Record<string, unknown>,
        domainCapsule: capsules.domain.text,
        domainKeywords: capsules.domain.keywords ?? [],
        taskCapsule: capsules.task.text,
        taskKeywords: capsules.task.keywords ?? [],
        classification,
      });

      // Step 2: Query users matching country/language filters
      const usersNamespace = getEnv('PINECONE_USERS_NAMESPACE');

      // Query users by domain similarity with metadata filters
      const filterOptions: Parameters<typeof queryUsersByFilter>[0] = {
        jobVector: domainEmbedding,
        topK: NOTIFY_TOPK,
      };
      if (available_countries) filterOptions.countries = available_countries;
      if (available_languages) filterOptions.languages = available_languages;
      if (usersNamespace) filterOptions.namespace = usersNamespace;

      const domainMatches = await queryUsersByFilter(filterOptions);
      const poolSize = domainMatches.length;

      // Calculate pool size multiplier - be lenient for small pools
      let poolSizeMultiplier = 1.0;
      if (poolSize > 0 && poolSize < 30) {
        poolSizeMultiplier = 0.6; // 40% lower threshold for tiny pools
        log.info(
          { event: 'notify.tiny_pool', poolSize, multiplier: poolSizeMultiplier },
          'Tiny pool - significantly lowering thresholds'
        );
      } else if (poolSize >= 30 && poolSize < 100) {
        poolSizeMultiplier = 0.8; // 20% lower threshold for small pools
        log.info(
          { event: 'notify.small_pool', poolSize, multiplier: poolSizeMultiplier },
          'Small pool - lowering thresholds'
        );
      }

      log.info(
        {
          event: 'notify.users_queried',
          jobId: job_id,
          matchCount: domainMatches.length,
          countries: available_countries,
          languages: available_languages,
        },
        'Queried users matching filters'
      );

      if (domainMatches.length === 0) {
        const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        return reply.status(200).send({
          status: 'ok',
          job_id,
          job_class: classification.jobClass,
          notify_user_ids: [],
          total_candidates: 0,
          total_above_threshold: 0,
          threshold_used: classification.jobClass === 'specialized' ? MIN_THRESHOLD_SPECIALIZED : MIN_THRESHOLD_GENERIC,
          elapsed_ms: Math.round(elapsedMs),
        });
      }

      // Step 3: Get task scores for the matched users
      // We already have domain scores from the filter query
      const userIds = domainMatches.map((m) => m.userId);
      const domainScoreMap = new Map(domainMatches.map((m) => [m.userId, m.score]));
      const userMetadataMap = new Map(domainMatches.map((m) => [m.userId, m.metadata]));

      // Query task scores in chunks
      const taskScoreMap = new Map<string, number>();
      const userChunks = chunkArray(userIds, FILTER_CHUNK_SIZE);

      for (const chunk of userChunks) {
        const queryOptions: Parameters<typeof queryByVector>[0] = {
          values: taskEmbedding,
          topK: chunk.length,
          filter: {
            type: 'user',
            section: 'task',
            user_id: { $in: chunk },
          },
        };
        if (usersNamespace) queryOptions.namespace = usersNamespace;

        const taskMatches = await queryByVector(queryOptions);

        for (const match of taskMatches) {
          const metadata = match.metadata as Record<string, unknown> | undefined;
          const userId = metadata?.user_id as string | undefined;
          if (userId) {
            taskScoreMap.set(userId, match.score);
          }
        }
      }

      // Step 4: Calculate final scores and apply thresholds
      const weights = getWeightProfile(classification.jobClass);
      const scoredUsers: Array<{
        userId: string;
        domainScore: number;
        taskScore: number;
        finalScore: number;
        expertiseTier: string | undefined;
        threshold: number;
        aboveThreshold: boolean;
      }> = [];

      for (const userId of userIds) {
        const domainScore = domainScoreMap.get(userId) ?? 0;
        const taskScore = taskScoreMap.get(userId) ?? 0;
        const finalScore = weights.w_domain * domainScore + weights.w_task * taskScore;

        // Get user's expertise tier from metadata (kept for audit logging)
        const metadata = userMetadataMap.get(userId) as Record<string, unknown> | undefined;
        const expertiseTier = metadata?.expertise_tier as string | undefined;

        // Calculate threshold with pool size adjustment
        const baseThreshold = getBaseMinThreshold(classification.jobClass);
        const threshold = baseThreshold * poolSizeMultiplier;
        const aboveThreshold = finalScore >= threshold;

        scoredUsers.push({
          userId,
          domainScore,
          taskScore,
          finalScore,
          expertiseTier,
          threshold,
          aboveThreshold,
        });
      }

      // Sort by final score descending
      scoredUsers.sort((a, b) => b.finalScore - a.finalScore);

      // Filter to users above their threshold
      let qualifiedUsers = scoredUsers.filter((u) => u.aboveThreshold);

      // Step 5: Subject matter code filtering for specialized jobs
      // Jobs have subject_matter_codes like ["technology:angular", "medical:obgyn"]
      // Filter users to only those with overlapping codes
      const jobSubjectMatterCodes = classification.requirements.subjectMatterCodes ?? [];
      const subjectMatterFilteredUserIds = new Set<string>();
      const userMatchDetails = new Map<string, SemanticMatchResult>();

      if (jobSubjectMatterCodes.length > 0 && qualifiedUsers.length > 0) {
        log.info(
          {
            event: 'notify.subject_matter_filter_start',
            jobId: job_id,
            jobSubjectMatterCodes,
            candidatesBeforeFilter: qualifiedUsers.length,
          },
          'Starting subject matter code filtering (semantic embeddings)'
        );

        const usersBeforeFilter = qualifiedUsers.length;

        // Use embedding-based semantic matching for subject matter codes
        // This replaces hardcoded synonym mappings with real semantic similarity
        const semanticFilterResults = await Promise.all(
          qualifiedUsers.map(async (u) => {
            const metadata = userMetadataMap.get(u.userId) as Record<string, unknown> | undefined;
            const userCodes = (metadata?.subject_matter_codes as string[]) ?? [];
            const matchDetails = await getSemanticMatchDetails(userCodes, jobSubjectMatterCodes);
            userMatchDetails.set(u.userId, matchDetails);
            return { user: u, matchDetails };
          })
        );

        // Track filtered users and update qualified list
        for (const result of semanticFilterResults) {
          if (!result.matchDetails.hasMatch) {
            subjectMatterFilteredUserIds.add(result.user.userId);
          }
        }

        qualifiedUsers = semanticFilterResults
          .filter((r) => r.matchDetails.hasMatch)
          .map((r) => r.user);

        log.info(
          {
            event: 'notify.subject_matter_filter_complete',
            jobId: job_id,
            jobSubjectMatterCodes,
            candidatesBeforeFilter: usersBeforeFilter,
            candidatesAfterFilter: qualifiedUsers.length,
            filteredOut: usersBeforeFilter - qualifiedUsers.length,
          },
          'Subject matter code filtering complete (semantic embeddings)'
        );
      }

      // Apply safety cap
      const notifyUsers = qualifiedUsers.slice(0, max_notifications);

      // Create a set of notified user IDs for quick lookup
      const notifiedUserIds = new Set(notifyUsers.map((u) => u.userId));

      // Build audit results with filter reasons
      const auditResults = scoredUsers.map((u, index) => {
        const metadata = userMetadataMap.get(u.userId) as Record<string, unknown> | undefined;
        const userSubjectMatterCodes = (metadata?.subject_matter_codes as string[]) ?? [];
        let filterReason: string | null = null;

        if (!u.aboveThreshold) {
          filterReason = `below_threshold (${(u.threshold * 100).toFixed(0)}%)`;
        } else if (subjectMatterFilteredUserIds.has(u.userId)) {
          // Get detailed match info for better debugging
          const matchDetails = userMatchDetails.get(u.userId);
          if (!matchDetails || matchDetails.userCodes.length === 0) {
            // User has no subject matter codes
            filterReason = `no_subject_matter_codes`;
          } else if (matchDetails.bestSimilarity > 0) {
            // User had codes but similarity was too low
            const similarityPct = Math.round(matchDetails.bestSimilarity * 100);
            filterReason = `low_similarity (${similarityPct}%)`;
          } else {
            // Fallback
            filterReason = `missing_subject_matter (${jobSubjectMatterCodes.join(', ')})`;
          }
        } else if (!notifiedUserIds.has(u.userId)) {
          filterReason = 'max_cap';
        }

        return {
          userId: u.userId,
          userCountry: (metadata?.country as string) ?? null,
          userLanguages: (metadata?.languages as string[]) ?? [],
          userSubjectMatterCodes,
          expertiseTier: u.expertiseTier ?? null,
          domainScore: u.domainScore,
          taskScore: u.taskScore,
          finalScore: u.finalScore,
          thresholdUsed: u.threshold,
          notified: notifiedUserIds.has(u.userId),
          filterReason,
          rank: notifiedUserIds.has(u.userId) ? index + 1 : null,
        };
      });

      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const elapsedRounded = Math.round(elapsedMs);

      // Calculate counts for logging/auditing
      const aboveThresholdCount = scoredUsers.filter((u) => u.aboveThreshold).length;
      const subjectMatterFilteredCount = subjectMatterFilteredUserIds.size;
      const afterSubjectMatterFilterCount = qualifiedUsers.length;

      log.info(
        {
          event: 'notify.complete',
          jobId: job_id,
          jobClass: classification.jobClass,
          totalCandidates: userIds.length,
          totalAboveThreshold: aboveThresholdCount,
          subjectMatterFiltered: subjectMatterFilteredCount,
          afterAllFilters: afterSubjectMatterFilterCount,
          notifyCount: notifyUsers.length,
          maxNotifications: max_notifications,
          jobSubjectMatterCodes: jobSubjectMatterCodes.length > 0 ? jobSubjectMatterCodes : undefined,
          elapsedMs: elapsedRounded,
        },
        'Job notification processing complete'
      );

      // Audit logging (non-blocking)
      auditJobNotify({
        jobId: job_id,
        requestId,
        title: normalized.title,
        jobClass: classification.jobClass,
        countriesFilter: available_countries ?? [],
        languagesFilter: available_languages ?? [],
        maxNotifications: max_notifications,
        totalCandidates: userIds.length,
        totalAboveThreshold: aboveThresholdCount,
        notifyCount: notifyUsers.length,
        thresholdSpecialized: MIN_THRESHOLD_SPECIALIZED,
        thresholdGeneric: MIN_THRESHOLD_GENERIC,
        scoreMin: scoredUsers.length > 0 ? scoredUsers[scoredUsers.length - 1]!.finalScore : undefined,
        scoreMax: scoredUsers.length > 0 ? scoredUsers[0]!.finalScore : undefined,
        elapsedMs: elapsedRounded,
        results: auditResults,
      });

      return reply.status(200).send({
        status: 'ok',
        job_id,
        job_class: classification.jobClass,
        notify_user_ids: notifyUsers.map((u) => u.userId),
        total_candidates: userIds.length,
        total_above_threshold: aboveThresholdCount,
        // Subject matter code filtering stats (for specialized jobs)
        subject_matter_filter: jobSubjectMatterCodes.length > 0 ? {
          required_codes: jobSubjectMatterCodes,
          filtered_count: subjectMatterFilteredCount,
          passed_count: afterSubjectMatterFilterCount,
        } : undefined,
        // Include score distribution for debugging
        score_stats: {
          min: scoredUsers.length > 0 ? Math.round(scoredUsers[scoredUsers.length - 1]!.finalScore * 100) / 100 : null,
          max: scoredUsers.length > 0 ? Math.round(scoredUsers[0]!.finalScore * 100) / 100 : null,
          threshold_specialized: MIN_THRESHOLD_SPECIALIZED,
          threshold_generic: MIN_THRESHOLD_GENERIC,
        },
        elapsed_ms: elapsedRounded,
      });
    } catch (error) {
      const errorElapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const errorElapsedRounded = Math.round(errorElapsedMs);

      if (error instanceof AppError) {
        log.warn(
          { error: error.message, code: error.code, details: error.details, event: 'jobs.notify.error', elapsedMs: errorElapsedRounded },
          'Handled job notify error'
        );
        return reply.status(error.statusCode).send(toErrorResponse(error));
      }

      log.error({ err: error, event: 'jobs.notify.error', elapsedMs: errorElapsedRounded }, 'Unexpected error during job notify');
      const appError = new AppError({
        code: 'JOB_NOTIFY_FAILURE',
        statusCode: 500,
        message: 'Unexpected server error',
      });
      return reply.status(appError.statusCode).send(toErrorResponse(appError));
    }
  });
};
