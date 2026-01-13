import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { AppError, toErrorResponse } from '../utils/errors';
import { getEnv, requireEnv } from '../utils/env';
import { ensureAuthorized } from '../utils/auth';
import { EMBEDDING_DIMENSION } from '../services/embeddings';
import { fetchVectors, queryByVector, QueryMatch } from '../services/pinecone';
import { getWeightProfile, JobClass } from '../services/job-classifier';

const SCORE_FORMULA = 'two-channel-linear-v1';
const MAX_CANDIDATES = 50_000;
const TOPK_CAP = 10_000;
const FILTER_CHUNK_SIZE = 500;
const EPSILON = 1e-9;

const scoreRequestSchema = z.object({
  job_id: z.string().min(1),
  candidate_user_ids: z.array(z.string().min(1)).min(1).max(MAX_CANDIDATES),
  w_domain: z.number().nonnegative().default(1.0),
  w_task: z.number().nonnegative().default(0.0),
  // When true, automatically determine weights based on job classification
  // Specialized jobs use domain-heavy weights (0.85/0.15)
  // Generic jobs use task-heavy weights (0.3/0.7)
  auto_weights: z.boolean().default(false),
  topK: z.number().int().positive().max(MAX_CANDIDATES).optional(),
  threshold: z.number().min(-1).max(1).optional(),
});

type Channel = 'domain' | 'task';

interface CandidateScore {
  user_id: string;
  s_domain: number | null;
  s_task: number | null;
  final: number;
  rank: number;
}

function chunkArray<T>(items: readonly T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) {
    return [items.slice()];
  }
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function isValidVector(values: number[] | undefined): values is number[] {
  return Array.isArray(values) && values.length === EMBEDDING_DIMENSION;
}

function normalizeWeights(rawDomain: number, rawTask: number): { domain: number; task: number } {
  if (!Number.isFinite(rawDomain) || !Number.isFinite(rawTask)) {
    throw new AppError({
      code: 'UNPROCESSABLE_WEIGHTS',
      statusCode: 422,
      message: 'Weights must be finite numbers',
    });
  }

  const total = Math.max(rawDomain + rawTask, EPSILON);
  return {
    domain: rawDomain / total,
    task: rawTask / total,
  };
}

function extractScores(matches: QueryMatch[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const match of matches) {
    const metadata = match.metadata as Record<string, unknown> | undefined;
    const userId = (metadata?.user_id as string | undefined) ?? undefined;
    if (!userId) {
      continue;
    }
    const existing = map.get(userId);
    if (existing === undefined || match.score > existing) {
      map.set(userId, match.score);
    }
  }
  return map;
}

interface MergeScoresResult {
  results: CandidateScore[];
  missingDomain: string[];
  missingTask: string[];
  countGteThreshold?: number;
}

function mergeScores(
  candidateIds: string[],
  domainScores: Map<string, number>,
  taskScores: Map<string, number>,
  weights: { domain: number; task: number },
  threshold?: number
): MergeScoresResult {
  const missingDomain: string[] = [];
  const missingTask: string[] = [];
  const missingDomainSeen = new Set<string>();
  const missingTaskSeen = new Set<string>();

  const unsorted = candidateIds.map((userId) => {
    const hasDomain = domainScores.has(userId);
    const domainScore = hasDomain ? domainScores.get(userId)! : null;
    if (!hasDomain && !missingDomainSeen.has(userId)) {
      missingDomainSeen.add(userId);
      missingDomain.push(userId);
    }

    const hasTask = taskScores.has(userId);
    const taskScore = hasTask ? taskScores.get(userId)! : null;
    if (!hasTask && !missingTaskSeen.has(userId)) {
      missingTaskSeen.add(userId);
      missingTask.push(userId);
    }

    const finalRaw = weights.domain * (domainScore ?? 0) + weights.task * (taskScore ?? 0);

    return {
      user_id: userId,
      s_domain: domainScore,
      s_task: taskScore,
      finalRaw,
    };
  });

  unsorted.sort((a, b) => {
    if (b.finalRaw !== a.finalRaw) {
      return b.finalRaw - a.finalRaw;
    }
    const domainA = a.s_domain ?? Number.NEGATIVE_INFINITY;
    const domainB = b.s_domain ?? Number.NEGATIVE_INFINITY;
    if (domainB !== domainA) {
      return domainB - domainA;
    }
    return a.user_id.localeCompare(b.user_id);
  });

  const results: CandidateScore[] = unsorted.map((entry, index) => ({
    user_id: entry.user_id,
    s_domain: entry.s_domain !== null ? roundScore(entry.s_domain) : null,
    s_task: entry.s_task !== null ? roundScore(entry.s_task) : null,
    final: roundScore(entry.finalRaw),
    rank: index + 1,
  }));

  const countGteThreshold =
    threshold !== undefined ? unsorted.filter((entry) => entry.finalRaw >= threshold).length : undefined;

  const merged: MergeScoresResult = {
    results,
    missingDomain,
    missingTask,
  };

  if (countGteThreshold !== undefined) {
    merged.countGteThreshold = countGteThreshold;
  }

  return merged;
}

async function queryScoresForSection(options: {
  section: Channel;
  vector: number[];
  candidateChunks: string[][];
  topK: number;
  namespace?: string;
  requestId: string;
}): Promise<Map<string, number>> {
  const { section, vector, candidateChunks, topK, namespace, requestId } = options;
  const aggregate = new Map<string, number>();

  for (const chunk of candidateChunks) {
    if (chunk.length === 0) {
      continue;
    }

    const chunkTopK = Math.min(chunk.length, topK);
    if (chunkTopK <= 0) {
      continue;
    }

    try {
      const queryOptions: Parameters<typeof queryByVector>[0] = {
        values: vector,
        topK: chunkTopK,
        filter: {
          type: 'user',
          section,
          user_id: { $in: chunk },
        },
      };

      if (namespace) {
        queryOptions.namespace = namespace;
      }

      const matches = await queryByVector(queryOptions);
      const chunkScores = extractScores(matches);
      for (const [userId, score] of chunkScores.entries()) {
        const existing = aggregate.get(userId);
        if (existing === undefined || score > existing) {
          aggregate.set(userId, score);
        }
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw new AppError({
          code: 'PINECONE_FAILURE',
          statusCode: 502,
          message: `Timed out querying Pinecone (${section}). Try again.`,
          details: {
            phase: `query.${section}`,
            request_id: requestId,
            cause: {
              code: error.code,
            },
          },
        });
      }
      throw error;
    }
  }

  return aggregate;
}

export const matchRoutes: FastifyPluginAsync = async (fastify) => {
  const serviceApiKey = requireEnv('SERVICE_API_KEY');
  const jobsNamespace = getEnv('PINECONE_JOBS_NAMESPACE');
  const usersNamespace = getEnv('PINECONE_USERS_NAMESPACE');

  fastify.post('/v1/match/score_users_for_job', async (request, reply) => {
    const requestId = request.id as string;
    const log = request.log.child({ route: 'match.score_users_for_job', requestId });
    const startedAt = process.hrtime.bigint();

    try {
      ensureAuthorized(request.headers.authorization, serviceApiKey);

      const parsed = scoreRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError({
          code: 'BAD_REQUEST',
          statusCode: 400,
          message: 'Invalid request body',
          details: { issues: parsed.error.issues },
        });
      }

      const { job_id, candidate_user_ids, threshold, auto_weights } = parsed.data;
      const uniqueCandidates = Array.from(new Set(candidate_user_ids));

      // Validate weights early if not using auto_weights (before fetching job vectors)
      // This ensures we fail fast on invalid weights
      if (!auto_weights) {
        normalizeWeights(parsed.data.w_domain, parsed.data.w_task);
      }

      const requestedTopK = parsed.data.topK ?? uniqueCandidates.length;
      const topKCap = Math.min(TOPK_CAP, uniqueCandidates.length);
      const topK = Math.max(1, Math.min(requestedTopK, topKCap));

      const domainVectorId = `job_${job_id}::domain`;
      const taskVectorId = `job_${job_id}::task`;

      const fetchOptions = jobsNamespace ? { namespace: jobsNamespace } : undefined;
      let fetched;
      try {
        fetched = await fetchVectors([domainVectorId, taskVectorId], fetchOptions);
      } catch (error) {
        if (error instanceof AppError) {
          throw new AppError({
            code: 'PINECONE_FAILURE',
            statusCode: 502,
            message: 'Failed retrieving job vectors from Pinecone. Try again.',
            details: {
              phase: 'fetch.job',
              request_id: requestId,
              cause: {
                code: error.code,
              },
            },
          });
        }
        throw error;
      }

      const domainVector = fetched[domainVectorId]?.values;
      const taskVector = fetched[taskVectorId]?.values;

      if (!isValidVector(domainVector) || !isValidVector(taskVector)) {
        throw new AppError({
          code: 'JOB_VECTORS_MISSING',
          statusCode: 404,
          message: 'Job vectors not found; upsert job first via /v1/jobs/upsert.',
        });
      }

      // Extract job classification from metadata for smart matching
      const jobMetadata = fetched[domainVectorId]?.metadata as Record<string, unknown> | undefined;
      const jobClass = (jobMetadata?.job_class as JobClass | undefined) ?? 'generic';
      const requiredCredentials = (jobMetadata?.required_credentials as string[] | undefined) ?? [];
      const subjectMatterCodes = (jobMetadata?.subject_matter_codes as string[] | undefined) ?? [];

      // Determine weights: auto_weights uses job classification, otherwise use request values
      // Specialized jobs: domain-heavy (0.85 domain, 0.15 task) - expertise matters most
      // Generic jobs: task-heavy (0.3 domain, 0.7 task) - labeling experience matters most
      let weights: { domain: number; task: number };
      let weightsSource: 'auto' | 'request';

      if (auto_weights) {
        const profile = getWeightProfile(jobClass);
        weights = { domain: profile.w_domain, task: profile.w_task };
        weightsSource = 'auto';
        log.info(
          {
            event: 'match.auto_weights',
            jobId: job_id,
            jobClass,
            weights,
          },
          'Using automatic weights based on job classification'
        );
      } else {
        weights = normalizeWeights(parsed.data.w_domain, parsed.data.w_task);
        weightsSource = 'request';
      }

      const candidateChunks = chunkArray(uniqueCandidates, FILTER_CHUNK_SIZE);

      const sectionNamespace: { namespace?: string } = usersNamespace ? { namespace: usersNamespace } : {};
      const [domainScores, taskScores] = await Promise.all([
        queryScoresForSection({
          section: 'domain',
          vector: domainVector,
          candidateChunks,
          topK,
          requestId,
          ...sectionNamespace,
        }),
        queryScoresForSection({
          section: 'task',
          vector: taskVector,
          candidateChunks,
          topK,
          requestId,
          ...sectionNamespace,
        }),
      ]);

      const merged = mergeScores(candidate_user_ids, domainScores, taskScores, weights, threshold);

      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const elapsedRounded = Math.round(elapsedMs);

      log.info(
        {
          event: 'match.score.complete',
          jobId: job_id,
          jobClass,
          candidateCount: candidate_user_ids.length,
          uniqueCandidateCount: uniqueCandidates.length,
          topK,
          weights,
          weightsSource,
          missingDomain: merged.missingDomain.length,
          missingTask: merged.missingTask.length,
          elapsedMs: elapsedRounded,
          scoreFormula: SCORE_FORMULA,
        },
        'Computed job applicant scores'
      );

      const responseBody: Record<string, unknown> = {
        status: 'ok',
        job_id,
        // Job classification determines matching strategy:
        // - specialized: domain expertise weighted heavily, credential matching recommended
        // - generic: labeling experience weighted heavily, excludes overqualified domain experts
        job_classification: {
          job_class: jobClass,
          required_credentials: requiredCredentials,
          subject_matter_codes: subjectMatterCodes,
        },
        w_domain: roundScore(weights.domain),
        w_task: roundScore(weights.task),
        weights_source: weightsSource, // 'auto' if determined by job class, 'request' if caller specified
        results: merged.results,
        missing_vectors: {
          domain: merged.missingDomain,
          task: merged.missingTask,
        },
        elapsed_ms: elapsedRounded,
      };

      if (threshold !== undefined) {
        responseBody.threshold_used = threshold;
        responseBody.count_gte_threshold = merged.countGteThreshold ?? 0;
      }

      return reply.status(200).send(responseBody);
    } catch (error) {
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const elapsedRounded = Math.round(elapsedMs);

      if (error instanceof AppError) {
        request.log.warn(
          {
            error: error.message,
            code: error.code,
            details: error.details,
            event: 'match.score.error',
            elapsedMs: elapsedRounded,
          },
          'Handled job scoring error'
        );
        return reply.status(error.statusCode).send({ ...toErrorResponse(error), request_id: requestId });
      }

      request.log.error({ err: error, event: 'match.score.error', elapsedMs: elapsedRounded }, 'Unexpected error during job scoring');
      const appError = new AppError({
        code: 'MATCH_FAILURE',
        statusCode: 500,
        message: 'Unexpected server error',
      });
      return reply.status(appError.statusCode).send({ ...toErrorResponse(appError), request_id: requestId });
    }
  });
};
