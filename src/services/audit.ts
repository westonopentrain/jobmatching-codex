/**
 * Audit service for logging API events to the database
 *
 * All writes are non-blocking (fire-and-forget) to avoid slowing down API responses.
 * Errors are logged but do not affect the main request flow.
 */

import { getDb, isDatabaseAvailable } from './db';
import { logger } from '../utils/logger';
import type { NormalizedJobPosting, NormalizedUserProfile } from '../utils/types';
import type { JobClassificationResult } from './job-classifier';
import type { Prisma } from '@prisma/client';

// Types for audit data

export interface JobUpsertAuditData {
  jobId: string;
  requestId?: string | undefined;
  title?: string | undefined;
  rawInput?: Record<string, unknown> | undefined;
  domainCapsule?: string | undefined;
  domainKeywords?: string[] | undefined;
  taskCapsule?: string | undefined;
  taskKeywords?: string[] | undefined;
  classification?: JobClassificationResult | undefined;
  elapsedMs?: number | undefined;
}

export interface UserUpsertAuditData {
  userId: string;
  requestId?: string | undefined;
  rawInput?: Record<string, unknown> | undefined;
  resumeChars?: number | undefined;
  hasWorkExperience?: boolean | undefined;
  hasEducation?: boolean | undefined;
  hasLabelingExperience?: boolean | undefined;
  country?: string | undefined;
  languages?: string[] | undefined;
  domainCapsule?: string | undefined;
  taskCapsule?: string | undefined;
  evidenceDetected?: boolean | undefined;
  validationViolations?: string[] | undefined;
  elapsedMs?: number | undefined;
  // Classification data
  expertiseTier?: string | undefined;
  credentials?: string[] | undefined;
  subjectMatterCodes?: string[] | undefined;
  yearsExperience?: number | undefined;
  classificationConfidence?: number | undefined;
}

export interface MatchRequestAuditData {
  jobId: string;
  requestId?: string | undefined;
  candidateCount?: number | undefined;
  wDomain?: number | undefined;
  wTask?: number | undefined;
  weightsSource?: 'auto' | 'request' | undefined;
  thresholdUsed?: number | undefined;
  topKUsed?: number | undefined;
  resultsReturned?: number | undefined;
  countGteThreshold?: number | undefined;
  missingDomainVectors?: number | undefined;
  missingTaskVectors?: number | undefined;
  elapsedMs?: number | undefined;
  results?: Array<{
    userId: string;
    sDomain: number | null;
    sTask: number | null;
    finalScore: number;
    rank: number;
  }> | undefined;
}

export interface UserMatchRequestAuditData {
  userId: string;
  requestId?: string | undefined;
  jobCount?: number | undefined;
  weightsSource?: 'auto' | 'request' | undefined;
  thresholdUsed?: number | undefined;
  topKUsed?: number | undefined;
  resultsReturned?: number | undefined;
  countGteThreshold?: number | undefined;
  missingDomainVectors?: number | undefined;
  missingTaskVectors?: number | undefined;
  userExpertiseTier?: string | undefined;
  suggestedThreshold?: number | undefined;
  suggestedThresholdMethod?: string | undefined;
  elapsedMs?: number | undefined;
  results?: Array<{
    jobId: string;
    jobClass: string | null;
    wDomain: number | null;
    wTask: number | null;
    sDomain: number | null;
    sTask: number | null;
    finalScore: number;
    rank: number;
    jobThreshold: number;
    aboveThreshold: boolean;
  }> | undefined;
}

export interface JobNotifyAuditData {
  jobId: string;
  requestId: string;
  title?: string | undefined;
  jobClass?: string | undefined;
  countriesFilter: string[];
  languagesFilter: string[];
  maxNotifications: number;
  totalCandidates: number;
  totalAboveThreshold: number;
  notifyCount: number;
  thresholdSpecialized: number;
  thresholdGeneric: number;
  scoreMin?: number | undefined;
  scoreMax?: number | undefined;
  elapsedMs?: number | undefined;
  results?: Array<{
    userId: string;
    userCountry: string | null;
    userLanguages: string[];
    expertiseTier: string | null;
    domainScore: number;
    taskScore: number;
    finalScore: number;
    thresholdUsed: number;
    notified: boolean;
    filterReason: string | null;
    rank: number | null;
  }> | undefined;
}

/**
 * Log a job upsert to the audit trail (non-blocking)
 */
export function auditJobUpsert(data: JobUpsertAuditData): void {
  if (!isDatabaseAvailable()) {
    return;
  }

  // Fire and forget
  (async () => {
    try {
      const db = getDb();
      if (!db) return;

      await db.auditJobUpsert.create({
        data: {
          jobId: data.jobId,
          requestId: data.requestId ?? null,
          title: data.title ?? null,
          ...(data.rawInput ? { rawInput: data.rawInput as Prisma.InputJsonValue } : {}),
          domainCapsule: data.domainCapsule ?? null,
          domainKeywords: data.domainKeywords ?? [],
          taskCapsule: data.taskCapsule ?? null,
          taskKeywords: data.taskKeywords ?? [],
          jobClass: data.classification?.jobClass ?? null,
          classificationConfidence: data.classification?.confidence ?? null,
          credentials: data.classification?.requirements?.credentials ?? [],
          subjectMatterCodes: data.classification?.requirements?.subjectMatterCodes ?? [],
          expertiseTier: data.classification?.requirements?.expertiseTier ?? null,
          classificationReasoning: data.classification?.reasoning ?? null,
          elapsedMs: data.elapsedMs ?? null,
        },
      });

      logger.debug(
        { event: 'audit.job_upsert.saved', jobId: data.jobId },
        'Job upsert audit record saved'
      );
    } catch (error) {
      logger.error(
        { event: 'audit.job_upsert.error', jobId: data.jobId, error },
        'Failed to save job upsert audit record'
      );
    }
  })();
}

/**
 * Log a user upsert to the audit trail (non-blocking)
 */
export function auditUserUpsert(data: UserUpsertAuditData): void {
  if (!isDatabaseAvailable()) {
    return;
  }

  // Fire and forget
  (async () => {
    try {
      const db = getDb();
      if (!db) return;

      await db.auditUserUpsert.create({
        data: {
          userId: data.userId,
          requestId: data.requestId ?? null,
          ...(data.rawInput ? { rawInput: data.rawInput as Prisma.InputJsonValue } : {}),
          resumeChars: data.resumeChars ?? null,
          hasWorkExperience: data.hasWorkExperience ?? null,
          hasEducation: data.hasEducation ?? null,
          hasLabelingExperience: data.hasLabelingExperience ?? null,
          country: data.country ?? null,
          languages: data.languages ?? [],
          domainCapsule: data.domainCapsule ?? null,
          taskCapsule: data.taskCapsule ?? null,
          evidenceDetected: data.evidenceDetected ?? null,
          validationViolations: data.validationViolations ?? [],
          expertiseTier: data.expertiseTier ?? null,
          credentials: data.credentials ?? [],
          subjectMatterCodes: data.subjectMatterCodes ?? [],
          yearsExperience: data.yearsExperience ?? null,
          classificationConfidence: data.classificationConfidence ?? null,
          elapsedMs: data.elapsedMs ?? null,
        },
      });

      logger.debug(
        { event: 'audit.user_upsert.saved', userId: data.userId },
        'User upsert audit record saved'
      );
    } catch (error) {
      logger.error(
        { event: 'audit.user_upsert.error', userId: data.userId, error },
        'Failed to save user upsert audit record'
      );
    }
  })();
}

/**
 * Log a match request to the audit trail (non-blocking)
 */
export function auditMatchRequest(data: MatchRequestAuditData): void {
  if (!isDatabaseAvailable()) {
    return;
  }

  // Fire and forget
  (async () => {
    try {
      const db = getDb();
      if (!db) return;

      // Create the match request record
      const matchRequest = await db.auditMatchRequest.create({
        data: {
          jobId: data.jobId,
          requestId: data.requestId ?? null,
          candidateCount: data.candidateCount ?? null,
          wDomain: data.wDomain ?? null,
          wTask: data.wTask ?? null,
          weightsSource: data.weightsSource ?? null,
          thresholdUsed: data.thresholdUsed ?? null,
          topKUsed: data.topKUsed ?? null,
          resultsReturned: data.resultsReturned ?? null,
          countGteThreshold: data.countGteThreshold ?? null,
          missingDomainVectors: data.missingDomainVectors ?? null,
          missingTaskVectors: data.missingTaskVectors ?? null,
          elapsedMs: data.elapsedMs ?? null,
        },
      });

      // Create result records if provided
      if (data.results && data.results.length > 0) {
        await db.auditMatchResult.createMany({
          data: data.results.map((r) => ({
            matchRequestId: matchRequest.id,
            userId: r.userId,
            sDomain: r.sDomain,
            sTask: r.sTask,
            finalScore: r.finalScore,
            rank: r.rank,
          })),
        });
      }

      logger.debug(
        {
          event: 'audit.match_request.saved',
          jobId: data.jobId,
          matchRequestId: matchRequest.id,
          resultsCount: data.results?.length ?? 0,
        },
        'Match request audit record saved'
      );
    } catch (error) {
      logger.error(
        { event: 'audit.match_request.error', jobId: data.jobId, error },
        'Failed to save match request audit record'
      );
    }
  })();
}

/**
 * Log a user match request (score_jobs_for_user) to the audit trail (non-blocking)
 */
export function auditUserMatchRequest(data: UserMatchRequestAuditData): void {
  if (!isDatabaseAvailable()) {
    return;
  }

  // Fire and forget
  (async () => {
    try {
      const db = getDb();
      if (!db) return;

      // Create the user match request record
      const matchRequest = await db.auditUserMatchRequest.create({
        data: {
          userId: data.userId,
          requestId: data.requestId ?? null,
          jobCount: data.jobCount ?? null,
          weightsSource: data.weightsSource ?? null,
          thresholdUsed: data.thresholdUsed ?? null,
          topKUsed: data.topKUsed ?? null,
          resultsReturned: data.resultsReturned ?? null,
          countGteThreshold: data.countGteThreshold ?? null,
          missingDomainVectors: data.missingDomainVectors ?? null,
          missingTaskVectors: data.missingTaskVectors ?? null,
          userExpertiseTier: data.userExpertiseTier ?? null,
          suggestedThreshold: data.suggestedThreshold ?? null,
          suggestedThresholdMethod: data.suggestedThresholdMethod ?? null,
          elapsedMs: data.elapsedMs ?? null,
        },
      });

      // Create result records if provided
      if (data.results && data.results.length > 0) {
        await db.auditUserMatchResult.createMany({
          data: data.results.map((r) => ({
            matchRequestId: matchRequest.id,
            jobId: r.jobId,
            jobClass: r.jobClass,
            wDomain: r.wDomain,
            wTask: r.wTask,
            sDomain: r.sDomain,
            sTask: r.sTask,
            finalScore: r.finalScore,
            rank: r.rank,
            jobThreshold: r.jobThreshold,
            aboveThreshold: r.aboveThreshold,
          })),
        });
      }

      logger.debug(
        {
          event: 'audit.user_match_request.saved',
          userId: data.userId,
          matchRequestId: matchRequest.id,
          resultsCount: data.results?.length ?? 0,
        },
        'User match request audit record saved'
      );
    } catch (error) {
      logger.error(
        { event: 'audit.user_match_request.error', userId: data.userId, error },
        'Failed to save user match request audit record'
      );
    }
  })();
}

/**
 * Log a job notification request to the audit trail (non-blocking)
 */
export function auditJobNotify(data: JobNotifyAuditData): void {
  if (!isDatabaseAvailable()) {
    return;
  }

  // Fire and forget
  (async () => {
    try {
      const db = getDb();
      if (!db) return;

      // Create the notification request record
      const notifyRequest = await db.auditJobNotify.create({
        data: {
          jobId: data.jobId,
          requestId: data.requestId,
          title: data.title ?? null,
          jobClass: data.jobClass ?? null,
          countriesFilter: data.countriesFilter,
          languagesFilter: data.languagesFilter,
          maxNotifications: data.maxNotifications,
          totalCandidates: data.totalCandidates,
          totalAboveThreshold: data.totalAboveThreshold,
          notifyCount: data.notifyCount,
          thresholdSpecialized: data.thresholdSpecialized,
          thresholdGeneric: data.thresholdGeneric,
          scoreMin: data.scoreMin ?? null,
          scoreMax: data.scoreMax ?? null,
          elapsedMs: data.elapsedMs ?? null,
        },
      });

      // Create result records if provided
      if (data.results && data.results.length > 0) {
        await db.auditJobNotifyResult.createMany({
          data: data.results.map((r) => ({
            notifyRequestId: notifyRequest.id,
            userId: r.userId,
            userCountry: r.userCountry,
            userLanguages: r.userLanguages,
            expertiseTier: r.expertiseTier,
            domainScore: r.domainScore,
            taskScore: r.taskScore,
            finalScore: r.finalScore,
            thresholdUsed: r.thresholdUsed,
            notified: r.notified,
            filterReason: r.filterReason,
            rank: r.rank,
          })),
        });
      }

      logger.debug(
        {
          event: 'audit.job_notify.saved',
          jobId: data.jobId,
          notifyRequestId: notifyRequest.id,
          resultsCount: data.results?.length ?? 0,
        },
        'Job notify audit record saved'
      );
    } catch (error) {
      logger.error(
        { event: 'audit.job_notify.error', jobId: data.jobId, error },
        'Failed to save job notify audit record'
      );
    }
  })();
}

/**
 * Helper to build audit data from job processing results
 */
export function buildJobAuditData(
  jobId: string,
  normalized: NormalizedJobPosting,
  capsules: { domain: { text: string; keywords: string[] }; task: { text: string; keywords: string[] } },
  classification: JobClassificationResult,
  requestId?: string,
  elapsedMs?: number
): JobUpsertAuditData {
  return {
    jobId,
    requestId,
    title: normalized.title,
    rawInput: normalized as unknown as Record<string, unknown>,
    domainCapsule: capsules.domain.text,
    domainKeywords: capsules.domain.keywords,
    taskCapsule: capsules.task.text,
    taskKeywords: capsules.task.keywords,
    classification,
    elapsedMs,
  };
}

/**
 * Helper to build audit data from user processing results
 */
export function buildUserAuditData(
  userId: string,
  normalized: NormalizedUserProfile,
  capsules: { domain: { text: string }; task: { text: string } },
  requestId?: string,
  elapsedMs?: number,
  validationViolations?: string[]
): UserUpsertAuditData {
  return {
    userId,
    requestId,
    resumeChars: normalized.resumeText?.length,
    hasWorkExperience: (normalized.workExperience?.length ?? 0) > 0,
    hasEducation: (normalized.education?.length ?? 0) > 0,
    hasLabelingExperience: (normalized.labelingExperience?.length ?? 0) > 0,
    country: normalized.country,
    languages: normalized.languages,
    domainCapsule: capsules.domain.text,
    taskCapsule: capsules.task.text,
    evidenceDetected: !capsules.task.text.includes('No AI/LLM data-labeling'),
    validationViolations,
    elapsedMs,
  };
}
