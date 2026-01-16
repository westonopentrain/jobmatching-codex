/**
 * Admin API endpoints for querying audit data
 */

import { FastifyPluginAsync } from 'fastify';
import { getDb, isDatabaseAvailable } from '../services/db';
import { logger } from '../utils/logger';
import { ensureAuthorized } from '../utils/auth';
import { requireEnv } from '../utils/env';

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  const serviceApiKey = requireEnv('SERVICE_API_KEY');

  // Check auth and database availability for all admin routes
  fastify.addHook('preHandler', async (request, reply) => {
    ensureAuthorized(request.headers.authorization, serviceApiKey);
    if (!isDatabaseAvailable()) {
      reply.status(503).send({ error: 'Database not available' });
    }
  });

  // Get recent job upserts
  fastify.get('/admin/jobs', async (request) => {
    const db = getDb();
    if (!db) return { error: 'Database not available' };

    const { limit = '20', jobId } = request.query as { limit?: string; jobId?: string };
    const take = Math.min(parseInt(limit, 10) || 20, 100);

    const where = jobId ? { jobId } : {};

    const records = await db.auditJobUpsert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        jobId: true,
        requestId: true,
        createdAt: true,
        title: true,
        domainCapsule: true,
        taskCapsule: true,
        jobClass: true,
        classificationConfidence: true,
        credentials: true,
        expertiseTier: true,
        elapsedMs: true,
      },
    });

    logger.info(
      { event: 'admin.jobs.query', count: records.length, jobId },
      'Admin queried job audit records'
    );

    return { count: records.length, records };
  });

  // Get a single job's full audit record
  fastify.get('/admin/jobs/:jobId', async (request) => {
    const db = getDb();
    if (!db) return { error: 'Database not available' };

    const { jobId } = request.params as { jobId: string };

    const records = await db.auditJobUpsert.findMany({
      where: { jobId },
      orderBy: { createdAt: 'desc' },
    });

    // Also get any match requests for this job
    const matchRequests = await db.auditMatchRequest.findMany({
      where: { jobId },
      orderBy: { createdAt: 'desc' },
      include: {
        results: {
          orderBy: { rank: 'asc' },
          take: 50,
        },
      },
    });

    return {
      jobId,
      upsertCount: records.length,
      upserts: records,
      matchRequestCount: matchRequests.length,
      matchRequests,
    };
  });

  // Get recent user upserts
  fastify.get('/admin/users', async (request) => {
    const db = getDb();
    if (!db) return { error: 'Database not available' };

    const { limit = '20', userId } = request.query as { limit?: string; userId?: string };
    const take = Math.min(parseInt(limit, 10) || 20, 100);

    const where = userId ? { userId } : {};

    const records = await db.auditUserUpsert.findMany({
      where,
      distinct: ['userId'],
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        userId: true,
        requestId: true,
        createdAt: true,
        resumeChars: true,
        hasWorkExperience: true,
        hasEducation: true,
        hasLabelingExperience: true,
        country: true,
        languages: true,
        domainCapsule: true,
        evidenceDetected: true,
        validationViolations: true,
        expertiseTier: true,
        credentials: true,
        subjectMatterCodes: true,
        yearsExperience: true,
        classificationConfidence: true,
        elapsedMs: true,
      },
    });

    logger.info(
      { event: 'admin.users.query', count: records.length, userId },
      'Admin queried user audit records'
    );

    return { count: records.length, records };
  });

  // Get a single user's full audit record
  fastify.get('/admin/users/:userId', async (request) => {
    const db = getDb();
    if (!db) return { error: 'Database not available' };

    const { userId } = request.params as { userId: string };

    const records = await db.auditUserUpsert.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    // Also get any match results for this user
    const matchResults = await db.auditMatchResult.findMany({
      where: { userId },
      orderBy: { id: 'desc' },
      take: 50,
      include: {
        matchRequest: {
          select: {
            id: true,
            jobId: true,
            createdAt: true,
            weightsSource: true,
            wDomain: true,
            wTask: true,
          },
        },
      },
    });

    return {
      userId,
      upsertCount: records.length,
      upserts: records,
      matchResultCount: matchResults.length,
      matchResults,
    };
  });

  // Get recent match requests
  fastify.get('/admin/matches', async (request) => {
    const db = getDb();
    if (!db) return { error: 'Database not available' };

    const { limit = '20', jobId } = request.query as { limit?: string; jobId?: string };
    const take = Math.min(parseInt(limit, 10) || 20, 100);

    const where = jobId ? { jobId } : {};

    const records = await db.auditMatchRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        jobId: true,
        requestId: true,
        createdAt: true,
        candidateCount: true,
        wDomain: true,
        wTask: true,
        weightsSource: true,
        thresholdUsed: true,
        topKUsed: true,
        resultsReturned: true,
        countGteThreshold: true,
        elapsedMs: true,
      },
    });

    logger.info(
      { event: 'admin.matches.query', count: records.length, jobId },
      'Admin queried match audit records'
    );

    return { count: records.length, records };
  });

  // Get a single match request with all results
  fastify.get('/admin/matches/:matchId', async (request) => {
    const db = getDb();
    if (!db) return { error: 'Database not available' };

    const { matchId } = request.params as { matchId: string };
    const id = parseInt(matchId, 10);
    if (isNaN(id)) {
      return { error: 'Invalid match ID' };
    }

    const matchRequest = await db.auditMatchRequest.findUnique({
      where: { id },
      include: {
        results: {
          orderBy: { rank: 'asc' },
        },
      },
    });

    if (!matchRequest) {
      return { error: 'Match request not found' };
    }

    // Get job info for context
    const jobInfo = await db.auditJobUpsert.findFirst({
      where: { jobId: matchRequest.jobId },
      orderBy: { createdAt: 'desc' },
      select: {
        title: true,
        jobClass: true,
        domainCapsule: true,
        taskCapsule: true,
      },
    });

    // Get user info for each result
    const userIds = matchRequest.results.map((r) => r.userId);
    const userInfos = await db.auditUserUpsert.findMany({
      where: { userId: { in: userIds } },
      distinct: ['userId'],
      orderBy: { createdAt: 'desc' },
      select: {
        userId: true,
        domainCapsule: true,
        taskCapsule: true,
        expertiseTier: true,
        credentials: true,
        country: true,
        languages: true,
      },
    });

    const userMap = new Map(userInfos.map((u) => [u.userId, u]));

    // Enrich results with user info
    const enrichedResults = matchRequest.results.map((r) => ({
      ...r,
      userInfo: userMap.get(r.userId) || null,
    }));

    logger.info(
      { event: 'admin.match.detail', matchId: id, resultsCount: matchRequest.results.length },
      'Admin queried match detail'
    );

    return {
      matchRequest: {
        ...matchRequest,
        results: enrichedResults,
      },
      jobInfo,
    };
  });

  // Get aggregate stats
  fastify.get('/admin/stats', async () => {
    const db = getDb();
    if (!db) return { error: 'Database not available' };

    const [jobCount, userCount, matchCount, resultCount] = await Promise.all([
      db.auditJobUpsert.count(),
      db.auditUserUpsert.count(),
      db.auditMatchRequest.count(),
      db.auditMatchResult.count(),
    ]);

    // Get counts from last 24 hours
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [jobsLast24h, usersLast24h, matchesLast24h] = await Promise.all([
      db.auditJobUpsert.count({ where: { createdAt: { gte: since } } }),
      db.auditUserUpsert.count({ where: { createdAt: { gte: since } } }),
      db.auditMatchRequest.count({ where: { createdAt: { gte: since } } }),
    ]);

    return {
      totals: {
        jobs: jobCount,
        users: userCount,
        matchRequests: matchCount,
        matchResults: resultCount,
      },
      last24Hours: {
        jobs: jobsLast24h,
        users: usersLast24h,
        matchRequests: matchesLast24h,
      },
    };
  });
};
