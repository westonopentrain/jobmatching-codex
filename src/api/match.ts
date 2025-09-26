import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { AppError, toErrorResponse } from '../utils/errors';
import { requireEnv } from '../utils/env';
import { ensureAuthorized } from '../utils/auth';
import { EMBEDDING_DIMENSION } from '../services/embeddings';
import { fetchVectors, queryByVector, QueryMatch } from '../services/pinecone';

const scoreRequestSchema = z.object({
  job_id: z.string().min(1),
  candidate_user_ids: z.array(z.string().min(1)).min(1),
  w_domain: z.number().min(0).default(1.0),
  w_task: z.number().min(0).default(1.0),
  topK: z.number().int().positive().optional(),
  threshold: z.number().min(-1).max(1).optional(),
});

interface ScoreEntry {
  user_id: string;
  s_domain: number;
  s_task: number;
  final: number;
}

function buildFilter(section: 'domain' | 'task', candidateIds: string[]) {
  return {
    section,
    user_id: { $in: candidateIds },
  } as Record<string, unknown>;
}

function extractScores(matches: QueryMatch[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const match of matches) {
    const metadata = match.metadata as Record<string, unknown> | undefined;
    const userId = (metadata?.user_id as string | undefined) ?? undefined;
    if (!userId) {
      continue;
    }
    if (!map.has(userId) || (map.get(userId) ?? 0) < match.score) {
      map.set(userId, match.score);
    }
  }
  return map;
}

function ensureVectorExists(values: number[] | undefined, vectorId: string): asserts values is number[] {
  if (!values || values.length !== EMBEDDING_DIMENSION) {
    throw new AppError({
      code: 'MISSING_VECTOR',
      statusCode: 404,
      message: `Vector ${vectorId} was not found or is invalid`,
    });
  }
}

export const matchRoutes: FastifyPluginAsync = async (fastify) => {
  const serviceApiKey = requireEnv('SERVICE_API_KEY');

  fastify.post('/v1/match/score_users_for_job', async (request, reply) => {
    const requestId = request.id as string;
    const log = request.log.child({ route: 'match.score_users_for_job', requestId });
    const startedAt = process.hrtime.bigint();

    try {
      ensureAuthorized(request.headers.authorization, serviceApiKey);

      const parsed = scoreRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          statusCode: 400,
          message: 'Invalid request body',
          details: { issues: parsed.error.issues },
        });
      }

      const { job_id, candidate_user_ids } = parsed.data;
      const uniqueCandidates = Array.from(new Set(candidate_user_ids));
      const weightDomain = parsed.data.w_domain;
      const weightTask = parsed.data.w_task;
      const requestedTopK = parsed.data.topK ?? uniqueCandidates.length;
      const topK = Math.max(1, Math.min(requestedTopK, uniqueCandidates.length));

      const domainVectorId = `job_${job_id}::domain`;
      const taskVectorId = `job_${job_id}::task`;

      const fetched = await fetchVectors([domainVectorId, taskVectorId]);
      const domainVector = fetched[domainVectorId]?.values;
      const taskVector = fetched[taskVectorId]?.values;

      ensureVectorExists(domainVector, domainVectorId);
      ensureVectorExists(taskVector, taskVectorId);

      let domainScores = new Map<string, number>();
      let taskScores = new Map<string, number>();

      if (weightDomain > 0) {
        const domainMatches = await queryByVector({
          values: domainVector,
          topK,
          filter: buildFilter('domain', uniqueCandidates),
        });
        domainScores = extractScores(domainMatches);
      }

      if (weightTask > 0) {
        const taskMatches = await queryByVector({
          values: taskVector,
          topK,
          filter: buildFilter('task', uniqueCandidates),
        });
        taskScores = extractScores(taskMatches);
      }

      const results: ScoreEntry[] = uniqueCandidates.map((userId) => {
        const domainScore = domainScores.get(userId) ?? 0;
        const taskScore = taskScores.get(userId) ?? 0;
        const finalScore = weightDomain * domainScore + weightTask * taskScore;
        return {
          user_id: userId,
          s_domain: Number(domainScore.toFixed(5)),
          s_task: Number(taskScore.toFixed(5)),
          final: Number(finalScore.toFixed(5)),
        };
      });

      results.sort((a, b) => b.final - a.final);

      const threshold = parsed.data.threshold;
      const countGteThreshold =
        threshold !== undefined
          ? results.filter((entry) => entry.final >= threshold).length
          : undefined;

      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

      log.info(
        {
          event: 'match.score.complete',
          jobId: job_id,
          candidateCount: uniqueCandidates.length,
          elapsedMs: Number(elapsedMs.toFixed(2)),
        },
        'Computed manual job match scores'
      );

      return reply.status(200).send({
        status: 'ok',
        job_id,
        w_domain: weightDomain,
        w_task: weightTask,
        threshold_used: threshold,
        results,
        count_gte_threshold: countGteThreshold,
      });
    } catch (error) {
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const elapsedRounded = Number(elapsedMs.toFixed(2));
      if (error instanceof AppError) {
        request.log.warn(
          { error: error.message, code: error.code, details: error.details, event: 'match.score.error', elapsedMs: elapsedRounded },
          'Handled job scoring error'
        );
        return reply.status(error.statusCode).send(toErrorResponse(error));
      }

      request.log.error({ err: error, event: 'match.score.error', elapsedMs: elapsedRounded }, 'Unexpected error during job scoring');
      const appError = new AppError({
        code: 'MATCH_FAILURE',
        statusCode: 500,
        message: 'Unexpected server error',
      });
      return reply.status(appError.statusCode).send(toErrorResponse(appError));
    }
  });
};
