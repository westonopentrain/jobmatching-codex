/**
 * Qualifications Service
 *
 * Manages job-user qualification tracking:
 * - Stores qualification results from /v1/jobs/notify
 * - Tracks notification status (who was notified, when, via what trigger)
 * - Manages job active status
 * - Provides query endpoints for dashboard and Bubble integration
 */

import { getDb, isDatabaseAvailable } from './db';
import { logger } from '../utils/logger';

export interface QualificationResult {
  userId: string;
  qualifies: boolean;
  finalScore: number | null;
  domainScore: number | null;
  taskScore: number | null;
  thresholdUsed: number | null;
  filterReason: string | null;
}

export interface StoredQualification {
  id: number;
  jobId: string;
  userId: string;
  qualifies: boolean;
  finalScore: number | null;
  domainScore: number | null;
  taskScore: number | null;
  thresholdUsed: number | null;
  filterReason: string | null;
  notifiedAt: Date | null;
  notifiedVia: string | null;
  evaluatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  jobActive: boolean;
}

/**
 * Ensure a job record exists in the jobs table
 */
export async function ensureJobExists(
  jobId: string,
  options: { title?: string; isActive?: boolean } = {}
): Promise<void> {
  if (!isDatabaseAvailable()) return;

  const db = getDb();
  if (!db) return;

  try {
    await db.job.upsert({
      where: { id: jobId },
      create: {
        id: jobId,
        title: options.title ?? null,
        isActive: options.isActive ?? true,
      },
      update: {
        ...(options.title !== undefined ? { title: options.title } : {}),
        ...(options.isActive !== undefined ? { isActive: options.isActive } : {}),
      },
    });
  } catch (error) {
    logger.error(
      { event: 'qualifications.ensure_job.error', jobId, error },
      'Failed to ensure job exists'
    );
  }
}

/**
 * Set job active status
 */
export async function setJobActiveStatus(
  jobId: string,
  isActive: boolean,
  title?: string
): Promise<{ success: boolean; job?: { id: string; isActive: boolean; title: string | null } }> {
  if (!isDatabaseAvailable()) {
    return { success: false };
  }

  const db = getDb();
  if (!db) {
    return { success: false };
  }

  try {
    const job = await db.job.upsert({
      where: { id: jobId },
      create: {
        id: jobId,
        isActive,
        title: title ?? null,
      },
      update: {
        isActive,
        ...(title !== undefined ? { title } : {}),
      },
    });

    // Update denormalized jobActive field in qualifications
    await db.jobUserQualification.updateMany({
      where: { jobId },
      data: { jobActive: isActive },
    });

    logger.info(
      { event: 'qualifications.job_status.updated', jobId, isActive },
      'Job active status updated'
    );

    return { success: true, job: { id: job.id, isActive: job.isActive, title: job.title } };
  } catch (error) {
    logger.error(
      { event: 'qualifications.job_status.error', jobId, isActive, error },
      'Failed to update job status'
    );
    return { success: false };
  }
}

/**
 * Get job by ID
 */
export async function getJob(jobId: string): Promise<{ id: string; isActive: boolean; title: string | null } | null> {
  if (!isDatabaseAvailable()) return null;

  const db = getDb();
  if (!db) return null;

  try {
    const job = await db.job.findUnique({
      where: { id: jobId },
    });
    return job ? { id: job.id, isActive: job.isActive, title: job.title } : null;
  } catch (error) {
    logger.error({ event: 'qualifications.get_job.error', jobId, error }, 'Failed to get job');
    return null;
  }
}

/**
 * Get all active jobs
 */
export async function getActiveJobs(): Promise<Array<{ id: string; title: string | null }>> {
  if (!isDatabaseAvailable()) return [];

  const db = getDb();
  if (!db) return [];

  try {
    const jobs = await db.job.findMany({
      where: { isActive: true },
      select: { id: true, title: true },
    });
    return jobs;
  } catch (error) {
    logger.error({ event: 'qualifications.get_active_jobs.error', error }, 'Failed to get active jobs');
    return [];
  }
}

/**
 * Store qualification results for a job
 * Called after /v1/jobs/notify evaluates users
 */
export async function storeQualificationResults(
  jobId: string,
  results: QualificationResult[],
  options: {
    markNotified?: boolean;
    notifiedVia?: string;
    jobTitle?: string;
    isActive?: boolean;
  } = {}
): Promise<{ stored: number; errors: number }> {
  if (!isDatabaseAvailable()) {
    return { stored: 0, errors: 0 };
  }

  const db = getDb();
  if (!db) {
    return { stored: 0, errors: 0 };
  }

  const now = new Date();
  let stored = 0;
  let errors = 0;

  try {
    // Ensure job exists
    const jobExistsOptions: { title?: string; isActive?: boolean } = {};
    if (options.jobTitle !== undefined) jobExistsOptions.title = options.jobTitle;
    if (options.isActive !== undefined) jobExistsOptions.isActive = options.isActive;
    await ensureJobExists(jobId, jobExistsOptions);

    // Get job's active status for denormalization
    const job = await db.job.findUnique({ where: { id: jobId } });
    const jobActive = job?.isActive ?? false;

    // Upsert qualifications in batches
    const batchSize = 100;
    for (let i = 0; i < results.length; i += batchSize) {
      const batch = results.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (result) => {
          try {
            await db.jobUserQualification.upsert({
              where: {
                jobId_userId: { jobId, userId: result.userId },
              },
              create: {
                jobId,
                userId: result.userId,
                qualifies: result.qualifies,
                finalScore: result.finalScore,
                domainScore: result.domainScore,
                taskScore: result.taskScore,
                thresholdUsed: result.thresholdUsed,
                filterReason: result.filterReason,
                evaluatedAt: now,
                jobActive,
                ...(options.markNotified && result.qualifies
                  ? { notifiedAt: now, notifiedVia: options.notifiedVia ?? 'job_post' }
                  : {}),
              },
              update: {
                qualifies: result.qualifies,
                finalScore: result.finalScore,
                domainScore: result.domainScore,
                taskScore: result.taskScore,
                thresholdUsed: result.thresholdUsed,
                filterReason: result.filterReason,
                evaluatedAt: now,
                jobActive,
                ...(options.markNotified && result.qualifies
                  ? { notifiedAt: now, notifiedVia: options.notifiedVia ?? 'job_post' }
                  : {}),
              },
            });
            stored++;
          } catch (error) {
            errors++;
            logger.warn(
              { event: 'qualifications.store.user_error', jobId, userId: result.userId, error },
              'Failed to store qualification for user'
            );
          }
        })
      );
    }

    logger.info(
      { event: 'qualifications.stored', jobId, stored, errors, total: results.length },
      'Stored qualification results'
    );
  } catch (error) {
    logger.error(
      { event: 'qualifications.store.error', jobId, error },
      'Failed to store qualifications'
    );
  }

  return { stored, errors };
}

/**
 * Get qualifications for a job
 */
export async function getJobQualifications(
  jobId: string,
  options: {
    qualifiesOnly?: boolean;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ qualifications: StoredQualification[]; total: number }> {
  if (!isDatabaseAvailable()) {
    return { qualifications: [], total: 0 };
  }

  const db = getDb();
  if (!db) {
    return { qualifications: [], total: 0 };
  }

  try {
    const where = {
      jobId,
      ...(options.qualifiesOnly ? { qualifies: true } : {}),
    };

    const [qualifications, total] = await Promise.all([
      db.jobUserQualification.findMany({
        where,
        orderBy: [{ finalScore: 'desc' }],
        take: options.limit ?? 100,
        skip: options.offset ?? 0,
      }),
      db.jobUserQualification.count({ where }),
    ]);

    return { qualifications: qualifications as StoredQualification[], total };
  } catch (error) {
    logger.error(
      { event: 'qualifications.get_job.error', jobId, error },
      'Failed to get job qualifications'
    );
    return { qualifications: [], total: 0 };
  }
}

/**
 * Get pending notifications for a job (qualified but not notified)
 */
export async function getPendingNotifications(
  jobId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<{ pending: StoredQualification[]; total: number }> {
  if (!isDatabaseAvailable()) {
    return { pending: [], total: 0 };
  }

  const db = getDb();
  if (!db) {
    return { pending: [], total: 0 };
  }

  try {
    const where = {
      jobId,
      qualifies: true,
      notifiedAt: null,
    };

    const [pending, total] = await Promise.all([
      db.jobUserQualification.findMany({
        where,
        orderBy: [{ finalScore: 'desc' }],
        take: options.limit ?? 100,
        skip: options.offset ?? 0,
      }),
      db.jobUserQualification.count({ where }),
    ]);

    return { pending: pending as StoredQualification[], total };
  } catch (error) {
    logger.error(
      { event: 'qualifications.pending.error', jobId, error },
      'Failed to get pending notifications'
    );
    return { pending: [], total: 0 };
  }
}

/**
 * Mark users as notified for a job
 */
export async function markUsersNotified(
  jobId: string,
  userIds: string[],
  notifiedVia: string = 'manual'
): Promise<{ updated: number }> {
  if (!isDatabaseAvailable() || userIds.length === 0) {
    return { updated: 0 };
  }

  const db = getDb();
  if (!db) {
    return { updated: 0 };
  }

  try {
    const result = await db.jobUserQualification.updateMany({
      where: {
        jobId,
        userId: { in: userIds },
        qualifies: true,
      },
      data: {
        notifiedAt: new Date(),
        notifiedVia,
      },
    });

    logger.info(
      { event: 'qualifications.marked_notified', jobId, userCount: userIds.length, updated: result.count },
      'Marked users as notified'
    );

    return { updated: result.count };
  } catch (error) {
    logger.error(
      { event: 'qualifications.mark_notified.error', jobId, error },
      'Failed to mark users as notified'
    );
    return { updated: 0 };
  }
}

/**
 * Get qualifications for a user across all jobs
 */
export async function getUserQualifications(
  userId: string,
  options: {
    activeJobsOnly?: boolean;
    qualifiesOnly?: boolean;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ qualifications: StoredQualification[]; total: number }> {
  if (!isDatabaseAvailable()) {
    return { qualifications: [], total: 0 };
  }

  const db = getDb();
  if (!db) {
    return { qualifications: [], total: 0 };
  }

  try {
    const where = {
      userId,
      ...(options.activeJobsOnly ? { jobActive: true } : {}),
      ...(options.qualifiesOnly ? { qualifies: true } : {}),
    };

    const [qualifications, total] = await Promise.all([
      db.jobUserQualification.findMany({
        where,
        orderBy: [{ evaluatedAt: 'desc' }],
        take: options.limit ?? 100,
        skip: options.offset ?? 0,
      }),
      db.jobUserQualification.count({ where }),
    ]);

    return { qualifications: qualifications as StoredQualification[], total };
  } catch (error) {
    logger.error(
      { event: 'qualifications.get_user.error', userId, error },
      'Failed to get user qualifications'
    );
    return { qualifications: [], total: 0 };
  }
}

/**
 * Get qualification summary for dashboard
 */
export async function getQualificationSummary(): Promise<{
  activeJobs: number;
  totalQualifications: number;
  pendingNotifications: number;
  notifiedToday: number;
}> {
  if (!isDatabaseAvailable()) {
    return { activeJobs: 0, totalQualifications: 0, pendingNotifications: 0, notifiedToday: 0 };
  }

  const db = getDb();
  if (!db) {
    return { activeJobs: 0, totalQualifications: 0, pendingNotifications: 0, notifiedToday: 0 };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    const [activeJobs, totalQualifications, pendingNotifications, notifiedToday] = await Promise.all([
      db.job.count({ where: { isActive: true } }),
      db.jobUserQualification.count({ where: { qualifies: true } }),
      db.jobUserQualification.count({ where: { qualifies: true, notifiedAt: null, jobActive: true } }),
      db.jobUserQualification.count({ where: { notifiedAt: { gte: today } } }),
    ]);

    return { activeJobs, totalQualifications, pendingNotifications, notifiedToday };
  } catch (error) {
    logger.error(
      { event: 'qualifications.summary.error', error },
      'Failed to get qualification summary'
    );
    return { activeJobs: 0, totalQualifications: 0, pendingNotifications: 0, notifiedToday: 0 };
  }
}

/**
 * Get all pending notifications across all active jobs
 */
export async function getAllPendingNotifications(
  options: { limit?: number; offset?: number } = {}
): Promise<{
  pending: Array<StoredQualification & { jobTitle: string | null }>;
  total: number;
}> {
  if (!isDatabaseAvailable()) {
    return { pending: [], total: 0 };
  }

  const db = getDb();
  if (!db) {
    return { pending: [], total: 0 };
  }

  try {
    const where = {
      qualifies: true,
      notifiedAt: null,
      jobActive: true,
    };

    const [pendingRaw, total] = await Promise.all([
      db.jobUserQualification.findMany({
        where,
        include: {
          job: { select: { title: true } },
        },
        orderBy: [{ evaluatedAt: 'desc' }],
        take: options.limit ?? 100,
        skip: options.offset ?? 0,
      }),
      db.jobUserQualification.count({ where }),
    ]);

    const pending = pendingRaw.map((p) => ({
      ...p,
      jobTitle: p.job?.title ?? null,
    })) as Array<StoredQualification & { jobTitle: string | null }>;

    return { pending, total };
  } catch (error) {
    logger.error(
      { event: 'qualifications.all_pending.error', error },
      'Failed to get all pending notifications'
    );
    return { pending: [], total: 0 };
  }
}

/**
 * Delete qualifications for a job (used when job is deleted)
 */
export async function deleteJobQualifications(jobId: string): Promise<{ deleted: number }> {
  if (!isDatabaseAvailable()) {
    return { deleted: 0 };
  }

  const db = getDb();
  if (!db) {
    return { deleted: 0 };
  }

  try {
    // Delete job record (qualifications cascade delete)
    await db.job.delete({ where: { id: jobId } }).catch(() => {
      // Job might not exist, that's ok
    });

    logger.info(
      { event: 'qualifications.job_deleted', jobId },
      'Deleted job and qualifications'
    );

    return { deleted: 1 };
  } catch (error) {
    logger.error(
      { event: 'qualifications.delete_job.error', jobId, error },
      'Failed to delete job qualifications'
    );
    return { deleted: 0 };
  }
}
