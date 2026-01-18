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

    // Fetch job titles for all unique job IDs
    const jobIds = [...new Set(records.map((r) => r.jobId))];
    const jobs = await db.auditJobUpsert.findMany({
      where: { jobId: { in: jobIds } },
      orderBy: { createdAt: 'desc' },
      distinct: ['jobId'],
      select: { jobId: true, title: true },
    });
    const jobTitleMap = new Map(jobs.map((j) => [j.jobId, j.title]));

    // Add job title to each record
    const recordsWithTitle = records.map((r) => ({
      ...r,
      jobTitle: jobTitleMap.get(r.jobId) || null,
    }));

    logger.info(
      { event: 'admin.matches.query', count: records.length, jobId },
      'Admin queried match audit records'
    );

    return { count: recordsWithTitle.length, records: recordsWithTitle };
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

  // Delete a match request and its results
  fastify.delete('/admin/matches/:matchId', async (request) => {
    const db = getDb();
    if (!db) return { error: 'Database not available' };

    const { matchId } = request.params as { matchId: string };
    const id = parseInt(matchId, 10);

    if (isNaN(id)) {
      return { error: 'Invalid match ID' };
    }

    // First delete the results (due to foreign key constraint)
    const deletedResults = await db.auditMatchResult.deleteMany({
      where: { matchRequestId: id },
    });

    // Then delete the match request
    const deletedMatch = await db.auditMatchRequest.delete({
      where: { id },
    }).catch(() => null);

    if (!deletedMatch) {
      return { error: 'Match not found' };
    }

    logger.info(
      { event: 'admin.match.delete', matchId: id, resultsDeleted: deletedResults.count },
      'Admin deleted match request'
    );

    return {
      status: 'ok',
      deleted: {
        matchId: id,
        resultsCount: deletedResults.count,
      },
    };
  });

  // Get aggregate stats
  fastify.get('/admin/stats', async () => {
    const db = getDb();
    if (!db) return { error: 'Database not available' };

    const [jobCount, userCount, matchCount, resultCount, recCount, recResultCount, notifyCount, notifyResultCount] = await Promise.all([
      db.auditJobUpsert.count(),
      db.auditUserUpsert.count(),
      db.auditMatchRequest.count(),
      db.auditMatchResult.count(),
      db.auditUserMatchRequest.count(),
      db.auditUserMatchResult.count(),
      db.auditJobNotify.count(),
      db.auditJobNotifyResult.count(),
    ]);

    // Get counts from last 24 hours
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [jobsLast24h, usersLast24h, matchesLast24h, recsLast24h, notifyLast24h] = await Promise.all([
      db.auditJobUpsert.count({ where: { createdAt: { gte: since } } }),
      db.auditUserUpsert.count({ where: { createdAt: { gte: since } } }),
      db.auditMatchRequest.count({ where: { createdAt: { gte: since } } }),
      db.auditUserMatchRequest.count({ where: { createdAt: { gte: since } } }),
      db.auditJobNotify.count({ where: { createdAt: { gte: since } } }),
    ]);

    return {
      totals: {
        jobs: jobCount,
        users: userCount,
        matchRequests: matchCount,
        matchResults: resultCount,
        recommendations: recCount,
        recommendationResults: recResultCount,
        notifications: notifyCount,
        notificationResults: notifyResultCount,
      },
      last24Hours: {
        jobs: jobsLast24h,
        users: usersLast24h,
        matchRequests: matchesLast24h,
        recommendations: recsLast24h,
        notifications: notifyLast24h,
      },
    };
  });

  // Get recent user match requests (recommendations)
  fastify.get('/admin/recommendations', async (request) => {
    const db = getDb();
    if (!db) return { error: 'Database not available' };

    const { limit = '20', userId } = request.query as { limit?: string; userId?: string };
    const take = Math.min(parseInt(limit, 10) || 20, 100);

    const where = userId ? { userId } : {};

    const records = await db.auditUserMatchRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        userId: true,
        requestId: true,
        createdAt: true,
        jobCount: true,
        weightsSource: true,
        thresholdUsed: true,
        topKUsed: true,
        resultsReturned: true,
        countGteThreshold: true,
        missingDomainVectors: true,
        userExpertiseTier: true,
        suggestedThreshold: true,
        suggestedThresholdMethod: true,
        elapsedMs: true,
      },
    });

    // Fetch user info for display
    const userIds = [...new Set(records.map((r) => r.userId))];
    const users = await db.auditUserUpsert.findMany({
      where: { userId: { in: userIds } },
      orderBy: { createdAt: 'desc' },
      distinct: ['userId'],
      select: { userId: true, domainCapsule: true, expertiseTier: true, country: true },
    });
    const userMap = new Map(users.map((u) => [u.userId, u]));

    // Add user info to each record
    const recordsWithUser = records.map((r) => ({
      ...r,
      userInfo: userMap.get(r.userId) || null,
    }));

    logger.info(
      { event: 'admin.recommendations.query', count: records.length, userId },
      'Admin queried recommendation audit records'
    );

    return { count: recordsWithUser.length, records: recordsWithUser };
  });

  // Get a single user match request with all job scores
  fastify.get('/admin/recommendations/:recId', async (request) => {
    const db = getDb();
    if (!db) return { error: 'Database not available' };

    const { recId } = request.params as { recId: string };
    const id = parseInt(recId, 10);
    if (isNaN(id)) {
      return { error: 'Invalid recommendation ID' };
    }

    const matchRequest = await db.auditUserMatchRequest.findUnique({
      where: { id },
      include: {
        results: {
          orderBy: { rank: 'asc' },
        },
      },
    });

    if (!matchRequest) {
      return { error: 'Recommendation request not found' };
    }

    // Get user info for context
    const userInfo = await db.auditUserUpsert.findFirst({
      where: { userId: matchRequest.userId },
      orderBy: { createdAt: 'desc' },
      select: {
        domainCapsule: true,
        taskCapsule: true,
        expertiseTier: true,
        credentials: true,
        country: true,
        languages: true,
        resumeChars: true,
        hasWorkExperience: true,
        hasEducation: true,
        hasLabelingExperience: true,
      },
    });

    // Get job info for each result
    const jobIds = matchRequest.results.map((r) => r.jobId);
    const jobInfos = await db.auditJobUpsert.findMany({
      where: { jobId: { in: jobIds } },
      distinct: ['jobId'],
      orderBy: { createdAt: 'desc' },
      select: {
        jobId: true,
        title: true,
        domainCapsule: true,
        taskCapsule: true,
        jobClass: true,
        credentials: true,
      },
    });

    const jobMap = new Map(jobInfos.map((j) => [j.jobId, j]));

    // Enrich results with job info
    const enrichedResults = matchRequest.results.map((r) => ({
      ...r,
      jobInfo: jobMap.get(r.jobId) || null,
    }));

    logger.info(
      { event: 'admin.recommendation.detail', recId: id, resultsCount: matchRequest.results.length },
      'Admin queried recommendation detail'
    );

    return {
      matchRequest: {
        ...matchRequest,
        results: enrichedResults,
      },
      userInfo,
    };
  });

  // Get recent job notifications
  fastify.get('/admin/notifications', async (request) => {
    const db = getDb();
    if (!db) return { error: 'Database not available' };

    const { limit = '20', jobId } = request.query as { limit?: string; jobId?: string };
    const take = Math.min(parseInt(limit, 10) || 20, 100);

    const where = jobId ? { jobId } : {};

    const records = await db.auditJobNotify.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        jobId: true,
        requestId: true,
        createdAt: true,
        title: true,
        jobClass: true,
        countriesFilter: true,
        languagesFilter: true,
        maxNotifications: true,
        totalCandidates: true,
        totalAboveThreshold: true,
        notifyCount: true,
        thresholdSpecialized: true,
        thresholdGeneric: true,
        scoreMin: true,
        scoreMax: true,
        elapsedMs: true,
      },
    });

    logger.info(
      { event: 'admin.notifications.query', count: records.length, jobId },
      'Admin queried notification audit records'
    );

    return { count: records.length, records };
  });

  // Get a single notification with all user results
  fastify.get('/admin/notifications/:notifyId', async (request) => {
    const db = getDb();
    if (!db) return { error: 'Database not available' };

    const { notifyId } = request.params as { notifyId: string };
    const id = parseInt(notifyId, 10);
    if (isNaN(id)) {
      return { error: 'Invalid notification ID' };
    }

    const notifyRequest = await db.auditJobNotify.findUnique({
      where: { id },
      include: {
        results: {
          orderBy: { finalScore: 'desc' },
        },
      },
    });

    if (!notifyRequest) {
      return { error: 'Notification request not found' };
    }

    // Get job info for context
    const jobInfo = await db.auditJobUpsert.findFirst({
      where: { jobId: notifyRequest.jobId },
      orderBy: { createdAt: 'desc' },
      select: {
        title: true,
        jobClass: true,
        domainCapsule: true,
        taskCapsule: true,
        expertiseTier: true,
        credentials: true,
        subjectMatterCodes: true,
      },
    });

    // Get user info for each result
    const userIds = notifyRequest.results.map((r) => r.userId);
    const userInfos = await db.auditUserUpsert.findMany({
      where: { userId: { in: userIds } },
      distinct: ['userId'],
      orderBy: { createdAt: 'desc' },
      select: {
        userId: true,
        domainCapsule: true,
        expertiseTier: true,
        credentials: true,
        country: true,
        languages: true,
        subjectMatterCodes: true,
      },
    });

    const userMap = new Map(userInfos.map((u) => [u.userId, u]));

    // Enrich results with user info
    const enrichedResults = notifyRequest.results.map((r) => ({
      ...r,
      userInfo: userMap.get(r.userId) || null,
    }));

    logger.info(
      { event: 'admin.notification.detail', notifyId: id, resultsCount: notifyRequest.results.length },
      'Admin queried notification detail'
    );

    return {
      notifyRequest: {
        ...notifyRequest,
        results: enrichedResults,
      },
      jobInfo,
    };
  });

  // Delete a notification request and its results
  fastify.delete('/admin/notifications/:notifyId', async (request) => {
    const db = getDb();
    if (!db) return { error: 'Database not available' };

    const { notifyId } = request.params as { notifyId: string };
    const id = parseInt(notifyId, 10);

    if (isNaN(id)) {
      return { error: 'Invalid notification ID' };
    }

    // Delete the notification request (results deleted via cascade)
    const deletedNotify = await db.auditJobNotify.delete({
      where: { id },
    }).catch(() => null);

    if (!deletedNotify) {
      return { error: 'Notification not found' };
    }

    logger.info(
      { event: 'admin.notification.delete', notifyId: id },
      'Admin deleted notification request'
    );

    return {
      status: 'ok',
      deleted: {
        notifyId: id,
      },
    };
  });

  // Delete a user match request and its results
  fastify.delete('/admin/recommendations/:recId', async (request) => {
    const db = getDb();
    if (!db) return { error: 'Database not available' };

    const { recId } = request.params as { recId: string };
    const id = parseInt(recId, 10);

    if (isNaN(id)) {
      return { error: 'Invalid recommendation ID' };
    }

    // First delete the results (due to foreign key constraint)
    const deletedResults = await db.auditUserMatchResult.deleteMany({
      where: { matchRequestId: id },
    });

    // Then delete the match request
    const deletedMatch = await db.auditUserMatchRequest.delete({
      where: { id },
    }).catch(() => null);

    if (!deletedMatch) {
      return { error: 'Recommendation not found' };
    }

    logger.info(
      { event: 'admin.recommendation.delete', recId: id, resultsDeleted: deletedResults.count },
      'Admin deleted recommendation request'
    );

    return {
      status: 'ok',
      deleted: {
        recId: id,
        resultsCount: deletedResults.count,
      },
    };
  });
};
