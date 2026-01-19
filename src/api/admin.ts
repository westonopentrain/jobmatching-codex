/**
 * Admin API endpoints for querying audit data
 */

import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getDb, isDatabaseAvailable } from '../services/db';
import { logger } from '../utils/logger';
import { ensureAuthorized } from '../utils/auth';
import { requireEnv, getEnv } from '../utils/env';
import { getQualificationSummary, getAllPendingNotifications, getActiveJobs, syncActiveJobsFromBubble } from '../services/qualifications';

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
        acceptableSubjectCodes: true,
        subjectMatterStrictness: true,
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

  // Get sync health metrics for monitoring event-driven sync
  fastify.get('/admin/sync-health', async () => {
    const db = getDb();
    if (!db) return { error: 'Database not available' };

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Get counts by source for the last 24 hours
    const [userUpsertsBySource, jobUpsertsBySource, userMetadataUpdates, jobMetadataUpdates] = await Promise.all([
      // User upserts grouped by source
      db.auditUserUpsert.groupBy({
        by: ['source'],
        where: { createdAt: { gte: since } },
        _count: { id: true },
      }),
      // Job upserts grouped by source
      db.auditJobUpsert.groupBy({
        by: ['source'],
        where: { createdAt: { gte: since } },
        _count: { id: true },
      }),
      // User metadata updates grouped by source
      db.auditUserMetadataUpdate.groupBy({
        by: ['source'],
        where: { createdAt: { gte: since } },
        _count: { id: true },
      }),
      // Job metadata updates grouped by source
      db.auditJobMetadataUpdate.groupBy({
        by: ['source'],
        where: { createdAt: { gte: since } },
        _count: { id: true },
      }),
    ]);

    // Convert group results to source-keyed objects
    const userUpsertCounts: Record<string, number> = {};
    let userUpsertTotal = 0;
    for (const group of userUpsertsBySource) {
      const source = group.source || 'unknown';
      userUpsertCounts[source] = group._count.id;
      userUpsertTotal += group._count.id;
    }

    const jobUpsertCounts: Record<string, number> = {};
    let jobUpsertTotal = 0;
    for (const group of jobUpsertsBySource) {
      const source = group.source || 'unknown';
      jobUpsertCounts[source] = group._count.id;
      jobUpsertTotal += group._count.id;
    }

    const userMetadataCounts: Record<string, number> = {};
    let userMetadataTotal = 0;
    for (const group of userMetadataUpdates) {
      const source = group.source || 'unknown';
      userMetadataCounts[source] = group._count.id;
      userMetadataTotal += group._count.id;
    }

    const jobMetadataCounts: Record<string, number> = {};
    let jobMetadataTotal = 0;
    for (const group of jobMetadataUpdates) {
      const source = group.source || 'unknown';
      jobMetadataCounts[source] = group._count.id;
      jobMetadataTotal += group._count.id;
    }

    // Get average latencies by source
    const [userUpsertLatencies, jobUpsertLatencies, userMetadataLatencies, jobMetadataLatencies] = await Promise.all([
      db.auditUserUpsert.groupBy({
        by: ['source'],
        where: { createdAt: { gte: since }, elapsedMs: { not: null } },
        _avg: { elapsedMs: true },
      }),
      db.auditJobUpsert.groupBy({
        by: ['source'],
        where: { createdAt: { gte: since }, elapsedMs: { not: null } },
        _avg: { elapsedMs: true },
      }),
      db.auditUserMetadataUpdate.groupBy({
        by: ['source'],
        where: { createdAt: { gte: since }, elapsedMs: { not: null } },
        _avg: { elapsedMs: true },
      }),
      db.auditJobMetadataUpdate.groupBy({
        by: ['source'],
        where: { createdAt: { gte: since }, elapsedMs: { not: null } },
        _avg: { elapsedMs: true },
      }),
    ]);

    const avgLatencies = {
      userUpserts: Object.fromEntries(
        userUpsertLatencies.map((g) => [g.source || 'unknown', Math.round(g._avg.elapsedMs ?? 0)])
      ),
      jobUpserts: Object.fromEntries(
        jobUpsertLatencies.map((g) => [g.source || 'unknown', Math.round(g._avg.elapsedMs ?? 0)])
      ),
      userMetadataUpdates: Object.fromEntries(
        userMetadataLatencies.map((g) => [g.source || 'unknown', Math.round(g._avg.elapsedMs ?? 0)])
      ),
      jobMetadataUpdates: Object.fromEntries(
        jobMetadataLatencies.map((g) => [g.source || 'unknown', Math.round(g._avg.elapsedMs ?? 0)])
      ),
    };

    // Get recent syncs (mixed view of all activity)
    const [recentUserUpserts, recentJobUpserts, recentUserMetadata, recentJobMetadata] = await Promise.all([
      db.auditUserUpsert.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          userId: true,
          source: true,
          elapsedMs: true,
          createdAt: true,
        },
      }),
      db.auditJobUpsert.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          jobId: true,
          title: true,
          source: true,
          elapsedMs: true,
          createdAt: true,
        },
      }),
      db.auditUserMetadataUpdate.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          userId: true,
          source: true,
          elapsedMs: true,
          createdAt: true,
        },
      }),
      db.auditJobMetadataUpdate.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          jobId: true,
          source: true,
          elapsedMs: true,
          createdAt: true,
        },
      }),
    ]);

    // Combine and sort recent syncs
    const recentSyncs = [
      ...recentUserUpserts.map((r) => ({
        type: 'user_upsert' as const,
        id: r.userId,
        source: r.source,
        elapsedMs: r.elapsedMs,
        createdAt: r.createdAt,
      })),
      ...recentJobUpserts.map((r) => ({
        type: 'job_upsert' as const,
        id: r.jobId,
        title: r.title,
        source: r.source,
        elapsedMs: r.elapsedMs,
        createdAt: r.createdAt,
      })),
      ...recentUserMetadata.map((r) => ({
        type: 'user_metadata' as const,
        id: r.userId,
        source: r.source,
        elapsedMs: r.elapsedMs,
        createdAt: r.createdAt,
      })),
      ...recentJobMetadata.map((r) => ({
        type: 'job_metadata' as const,
        id: r.jobId,
        source: r.source,
        elapsedMs: r.elapsedMs,
        createdAt: r.createdAt,
      })),
    ]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 20);

    logger.info(
      {
        event: 'admin.sync_health.query',
        userUpsertTotal,
        jobUpsertTotal,
        userMetadataTotal,
        jobMetadataTotal,
      },
      'Admin queried sync health'
    );

    return {
      last24h: {
        userUpserts: { total: userUpsertTotal, ...userUpsertCounts },
        jobUpserts: { total: jobUpsertTotal, ...jobUpsertCounts },
        userMetadataUpdates: { total: userMetadataTotal, ...userMetadataCounts },
        jobMetadataUpdates: { total: jobMetadataTotal, ...jobMetadataCounts },
      },
      avgLatencyMs: avgLatencies,
      recentSyncs,
    };
  });

  // Get qualification summary for dashboard overview
  fastify.get('/admin/qualifications/summary', async () => {
    const summary = await getQualificationSummary();

    logger.info(
      { event: 'admin.qualifications.summary', ...summary },
      'Admin queried qualification summary'
    );

    return summary;
  });

  // Get all pending notifications across all active jobs
  fastify.get('/admin/pending-notifications', async (request) => {
    const { limit = '100', offset = '0' } = request.query as { limit?: string; offset?: string };

    const { pending, total } = await getAllPendingNotifications({
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });

    logger.info(
      { event: 'admin.pending_notifications.query', count: pending.length, total },
      'Admin queried pending notifications'
    );

    return {
      count: pending.length,
      total,
      pending: pending.map((p) => ({
        job_id: p.jobId,
        job_title: p.jobTitle,
        user_id: p.userId,
        final_score: p.finalScore,
        domain_score: p.domainScore,
        task_score: p.taskScore,
        threshold_used: p.thresholdUsed,
        evaluated_at: p.evaluatedAt,
      })),
    };
  });

  // Get list of active jobs
  fastify.get('/admin/jobs/active', async () => {
    const jobs = await getActiveJobs();

    logger.info(
      { event: 'admin.active_jobs.query', count: jobs.length },
      'Admin queried active jobs'
    );

    return {
      count: jobs.length,
      jobs: jobs.map((j) => ({
        job_id: j.id,
        title: j.title,
      })),
    };
  });

  // Sync active job status from Bubble
  // Bubble calls this with a list of active job IDs
  const syncActiveJobsSchema = z.object({
    active_job_ids: z.array(z.string()),
  });

  fastify.post('/admin/sync-active-jobs', async (request, reply) => {
    const parsed = syncActiveJobsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid request body',
        details: parsed.error.issues,
      });
    }

    const { active_job_ids } = parsed.data;

    const result = await syncActiveJobsFromBubble(active_job_ids);

    logger.info(
      {
        event: 'admin.sync_active_jobs',
        inputCount: active_job_ids.length,
        ...result,
      },
      'Admin synced active jobs from Bubble'
    );

    return {
      status: result.success ? 'ok' : 'error',
      input_count: active_job_ids.length,
      activated: result.activated,
      deactivated: result.deactivated,
      created: result.created,
      unchanged: result.unchanged,
    };
  });

  // Get job qualifications with user info for dashboard
  fastify.get('/admin/jobs/:jobId/qualifications', async (request) => {
    const db = getDb();
    if (!db) return { error: 'Database not available' };

    const { jobId } = request.params as { jobId: string };
    const { qualifies_only, limit = '100', offset = '0' } = request.query as {
      qualifies_only?: string;
      limit?: string;
      offset?: string;
    };

    // Get job info
    const job = await db.job.findUnique({
      where: { id: jobId },
    });

    // Get qualifications
    const where = {
      jobId,
      ...(qualifies_only === 'true' ? { qualifies: true } : {}),
    };

    const [qualifications, total] = await Promise.all([
      db.jobUserQualification.findMany({
        where,
        orderBy: [{ finalScore: 'desc' }],
        take: parseInt(limit, 10),
        skip: parseInt(offset, 10),
      }),
      db.jobUserQualification.count({ where }),
    ]);

    // Get user info for enrichment
    const userIds = qualifications.map((q) => q.userId);
    const userInfos = await db.auditUserUpsert.findMany({
      where: { userId: { in: userIds } },
      distinct: ['userId'],
      orderBy: { createdAt: 'desc' },
      select: {
        userId: true,
        domainCapsule: true,
        expertiseTier: true,
        country: true,
        languages: true,
        subjectMatterCodes: true,
      },
    });

    const userMap = new Map(userInfos.map((u) => [u.userId, u]));

    // Enrich qualifications with user info
    const enrichedQualifications = qualifications.map((q) => ({
      ...q,
      userInfo: userMap.get(q.userId) || null,
    }));

    logger.info(
      { event: 'admin.job_qualifications.query', jobId, count: qualifications.length, total },
      'Admin queried job qualifications'
    );

    return {
      job: job ? {
        job_id: job.id,
        is_active: job.isActive,
        title: job.title,
      } : null,
      count: qualifications.length,
      total,
      qualifications: enrichedQualifications.map((q) => ({
        user_id: q.userId,
        qualifies: q.qualifies,
        final_score: q.finalScore,
        domain_score: q.domainScore,
        task_score: q.taskScore,
        threshold_used: q.thresholdUsed,
        filter_reason: q.filterReason,
        notified_at: q.notifiedAt,
        notified_via: q.notifiedVia,
        evaluated_at: q.evaluatedAt,
        user_info: q.userInfo ? {
          domain_capsule: q.userInfo.domainCapsule,
          expertise_tier: q.userInfo.expertiseTier,
          country: q.userInfo.country,
          languages: q.userInfo.languages,
          subject_matter_codes: q.userInfo.subjectMatterCodes,
        } : null,
      })),
    };
  });

  // Get re-notify events (paginated) - monitoring endpoint
  fastify.get('/admin/re-notify', async (request) => {
    const db = getDb();
    if (!db) return { error: 'Database not available' };

    const { page = '1', limit = '50' } = request.query as { page?: string; limit?: string };
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [records, total] = await Promise.all([
      db.auditReNotify.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
        select: {
          id: true,
          jobId: true,
          requestId: true,
          createdAt: true,
          totalQualified: true,
          previouslyNotified: true,
          newlyQualified: true,
          elapsedMs: true,
        },
      }),
      db.auditReNotify.count(),
    ]);

    // Get job titles for display
    const jobIds = [...new Set(records.map((r) => r.jobId))];
    const jobs = jobIds.length > 0 ? await db.auditJobUpsert.findMany({
      where: { jobId: { in: jobIds } },
      orderBy: { createdAt: 'desc' },
      distinct: ['jobId'],
      select: { jobId: true, title: true },
    }) : [];
    const jobTitleMap = new Map(jobs.map((j) => [j.jobId, j.title]));

    logger.info(
      { event: 'admin.re_notify.query', count: records.length, total, page: pageNum },
      'Admin queried re-notify events'
    );

    return {
      count: records.length,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
      records: records.map((r) => ({
        id: r.id,
        job_id: r.jobId,
        job_title: jobTitleMap.get(r.jobId) || null,
        request_id: r.requestId,
        created_at: r.createdAt,
        total_qualified: r.totalQualified,
        previously_notified: r.previouslyNotified,
        newly_qualified: r.newlyQualified,
        elapsed_ms: r.elapsedMs,
      })),
    };
  });

  // Get recommended-jobs events (paginated) - monitoring endpoint
  fastify.get('/admin/recommended-jobs-log', async (request) => {
    const db = getDb();
    if (!db) return { error: 'Database not available' };

    const { page = '1', limit = '50' } = request.query as { page?: string; limit?: string };
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [records, total] = await Promise.all([
      db.auditRecommendedJobs.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
        select: {
          id: true,
          userId: true,
          requestId: true,
          createdAt: true,
          expertiseTier: true,
          country: true,
          languages: true,
          activeJobs: true,
          scoredJobs: true,
          recommendedCount: true,
          skippedByCountry: true,
          skippedByLanguage: true,
          elapsedMs: true,
        },
      }),
      db.auditRecommendedJobs.count(),
    ]);

    logger.info(
      { event: 'admin.recommended_jobs_log.query', count: records.length, total, page: pageNum },
      'Admin queried recommended-jobs events'
    );

    return {
      count: records.length,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
      records: records.map((r) => ({
        id: r.id,
        user_id: r.userId,
        request_id: r.requestId,
        created_at: r.createdAt,
        expertise_tier: r.expertiseTier,
        country: r.country,
        languages: r.languages,
        active_jobs: r.activeJobs,
        scored_jobs: r.scoredJobs,
        recommended_count: r.recommendedCount,
        skipped_by_country: r.skippedByCountry,
        skipped_by_language: r.skippedByLanguage,
        elapsed_ms: r.elapsedMs,
      })),
    };
  });
};
