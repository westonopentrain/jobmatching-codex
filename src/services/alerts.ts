/**
 * Alert rules and triggers for monitoring job matching quality
 */

import { sendSlackAlert, isSlackConfigured } from './slack';
import { logger } from '../utils/logger';

// Alert thresholds (can be made configurable via env vars later)
const LOW_MATCH_COUNT_THRESHOLD = 5;
const HIGH_MATCH_COUNT_THRESHOLD = 200;
const LOW_CONFIDENCE_THRESHOLD = 0.7;
const HIGH_MISSING_VECTORS_THRESHOLD = 0.5; // 50% of candidates missing vectors

export interface MatchAlertContext {
  jobId: string;
  jobTitle?: string | undefined;
  jobClass?: string | undefined;
  candidateCount: number;
  resultsCount: number;
  countAboveThreshold?: number | undefined;
  threshold?: number | undefined;
  missingDomainVectors: number;
  missingTaskVectors: number;
  classificationConfidence?: number | undefined;
  wDomain: number;
  wTask: number;
}

export interface JobUpsertAlertContext {
  jobId: string;
  jobTitle?: string | undefined;
  jobClass?: string | undefined;
  classificationConfidence?: number | undefined;
}

type AlertType = 'LOW_MATCH_COUNT' | 'HIGH_MATCH_COUNT' | 'LOW_CONFIDENCE' | 'HIGH_MISSING_VECTORS';

interface TriggeredAlert {
  type: AlertType;
  title: string;
  message: string;
  fields: Record<string, string>;
}

/**
 * Check match results for alert conditions and send notifications
 */
export function checkMatchAlerts(context: MatchAlertContext): void {
  if (!isSlackConfigured()) {
    return;
  }

  const alerts: TriggeredAlert[] = [];

  // Check for too few matches
  if (context.resultsCount < LOW_MATCH_COUNT_THRESHOLD) {
    alerts.push({
      type: 'LOW_MATCH_COUNT',
      title: 'Low Match Count Alert',
      message: `Job matched only *${context.resultsCount}* candidates (threshold: ${LOW_MATCH_COUNT_THRESHOLD}). May need manual recruiting.`,
      fields: {
        'Job ID': context.jobId,
        'Job Title': context.jobTitle || 'N/A',
        'Job Class': context.jobClass || 'N/A',
        'Candidates Scored': String(context.candidateCount),
        'Results Returned': String(context.resultsCount),
      },
    });
  }

  // Check for too many matches (may indicate weight issues)
  if (context.resultsCount > HIGH_MATCH_COUNT_THRESHOLD && context.threshold !== undefined) {
    const aboveThreshold = context.countAboveThreshold ?? context.resultsCount;
    if (aboveThreshold > HIGH_MATCH_COUNT_THRESHOLD) {
      alerts.push({
        type: 'HIGH_MATCH_COUNT',
        title: 'High Match Count Alert',
        message: `Job matched *${aboveThreshold}* candidates above threshold (threshold: ${context.threshold}). Consider adjusting weights or raising threshold.`,
        fields: {
          'Job ID': context.jobId,
          'Job Title': context.jobTitle || 'N/A',
          'Job Class': context.jobClass || 'N/A',
          'Above Threshold': String(aboveThreshold),
          'Threshold Used': String(context.threshold),
          'Weights': `domain=${context.wDomain}, task=${context.wTask}`,
        },
      });
    }
  }

  // Check for high missing vectors rate
  const missingRate = (context.missingDomainVectors + context.missingTaskVectors) / (2 * context.candidateCount);
  if (missingRate > HIGH_MISSING_VECTORS_THRESHOLD && context.candidateCount > 10) {
    alerts.push({
      type: 'HIGH_MISSING_VECTORS',
      title: 'Missing Vectors Alert',
      message: `*${Math.round(missingRate * 100)}%* of candidates are missing embeddings. Users may need to be upserted.`,
      fields: {
        'Job ID': context.jobId,
        'Candidates': String(context.candidateCount),
        'Missing Domain': String(context.missingDomainVectors),
        'Missing Task': String(context.missingTaskVectors),
      },
    });
  }

  // Send alerts
  for (const alert of alerts) {
    logger.info(
      { event: 'alert.triggered', alertType: alert.type, jobId: context.jobId },
      `Alert triggered: ${alert.type}`
    );
    sendSlackAlert(alert.title, alert.message, alert.fields);
  }
}

/**
 * Check job upsert for alert conditions
 */
export function checkJobUpsertAlerts(context: JobUpsertAlertContext): void {
  if (!isSlackConfigured()) {
    return;
  }

  const alerts: TriggeredAlert[] = [];

  // Check for low classification confidence
  if (context.classificationConfidence !== undefined && context.classificationConfidence < LOW_CONFIDENCE_THRESHOLD) {
    alerts.push({
      type: 'LOW_CONFIDENCE',
      title: 'Low Classification Confidence Alert',
      message: `Job classification confidence is *${(context.classificationConfidence * 100).toFixed(0)}%* (threshold: ${LOW_CONFIDENCE_THRESHOLD * 100}%). Review classification.`,
      fields: {
        'Job ID': context.jobId,
        'Job Title': context.jobTitle || 'N/A',
        'Classification': context.jobClass || 'N/A',
        'Confidence': `${(context.classificationConfidence * 100).toFixed(1)}%`,
      },
    });
  }

  // Send alerts
  for (const alert of alerts) {
    logger.info(
      { event: 'alert.triggered', alertType: alert.type, jobId: context.jobId },
      `Alert triggered: ${alert.type}`
    );
    sendSlackAlert(alert.title, alert.message, alert.fields);
  }
}
