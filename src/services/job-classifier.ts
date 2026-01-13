/**
 * Job classifier service using LLM-based classification.
 * Classifies jobs as 'specialized' (requiring domain expertise) or 'generic' (basic labeling tasks).
 */

import { NormalizedJobPosting } from '../utils/types';
import { createTextResponse } from './openai-responses';
import { resolveCapsuleModel } from './openai-model';
import { withRetry } from '../utils/retry';
import { logger } from '../utils/logger';

export type JobClass = 'specialized' | 'generic';
export type ExpertiseTier = 'entry' | 'intermediate' | 'expert' | 'specialist';

export interface JobClassificationResult {
  jobClass: JobClass;
  confidence: number;
  requirements: {
    credentials: string[];
    minimumExperienceYears: number;
    subjectMatterCodes: string[];
    expertiseTier: ExpertiseTier;
    countries: string[];
    languages: string[];
  };
  reasoning: string;
}

const CLASSIFICATION_SYSTEM_MESSAGE = `You are a job classification system for an AI training marketplace. Your task is to analyze job postings and classify them.

CLASSIFICATION RULES:
1. "specialized" jobs require specific domain expertise, professional credentials, or advanced degrees (e.g., MD, PhD, JD, PE). Examples: medical doctors reviewing health content, attorneys reviewing legal documents, engineers evaluating technical solutions.

2. "generic" jobs are basic data labeling tasks that anyone with basic skills can do. Examples: bounding box annotation, simple transcription, image tagging, basic classification.

IMPORTANT: If a job requires professional credentials (MD, PhD, JD, PE, CPA, etc.) or years of specialized experience, it is ALWAYS "specialized".

Return ONLY valid JSON in this exact format:
{
  "job_class": "specialized" | "generic",
  "confidence": 0.0-1.0,
  "credentials": ["MD", "PhD", etc] or [],
  "minimum_experience_years": number or 0,
  "subject_matter_codes": ["medical:obgyn", "legal:corporate", "engineering:civil", etc] or [],
  "expertise_tier": "entry" | "intermediate" | "expert" | "specialist",
  "countries": ["US", "UK", etc] or [],
  "languages": ["en", "es", etc] or [],
  "reasoning": "brief explanation"
}

Subject matter code format: "domain:specialty" where domain is one of: medical, legal, finance, engineering, science, education, technology. If no specific specialty, use "domain:general".`;

const CLASSIFICATION_TEMPERATURE = 0.1;
const CLASSIFICATION_MAX_TOKENS = 800;

/**
 * Build the job description text for classification.
 */
function buildJobText(job: NormalizedJobPosting): string {
  const parts: string[] = [];

  if (job.title) {
    parts.push(`Title: ${job.title}`);
  }
  if (job.dataSubjectMatter) {
    parts.push(`Subject Matter: ${job.dataSubjectMatter}`);
  }
  if (job.expertiseLevel) {
    parts.push(`Expertise Level: ${job.expertiseLevel}`);
  }
  if (job.requirementsAdditional) {
    parts.push(`Requirements: ${job.requirementsAdditional}`);
  }
  if (job.instructions) {
    parts.push(`Instructions: ${job.instructions}`);
  }
  if (job.labelTypes.length > 0) {
    parts.push(`Label Types: ${job.labelTypes.join(', ')}`);
  }
  if (job.availableCountries.length > 0) {
    parts.push(`Countries: ${job.availableCountries.join(', ')}`);
  }
  if (job.availableLanguages.length > 0) {
    parts.push(`Languages: ${job.availableLanguages.join(', ')}`);
  }
  if (job.datasetDescription) {
    parts.push(`Dataset: ${job.datasetDescription}`);
  }

  return parts.join('\n\n');
}

/**
 * Parse the LLM response into a structured result.
 */
function parseClassificationResponse(responseText: string): JobClassificationResult {
  // Extract JSON from response (handle markdown code blocks)
  let jsonText = responseText.trim();
  if (jsonText.startsWith('```')) {
    const match = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      jsonText = match[1]!.trim();
    }
  }

  const parsed = JSON.parse(jsonText);

  // Validate and normalize the response
  const jobClass: JobClass = parsed.job_class === 'specialized' ? 'specialized' : 'generic';
  const confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.8;

  const credentials: string[] = Array.isArray(parsed.credentials)
    ? parsed.credentials.map((c: unknown) => String(c).toUpperCase())
    : [];

  const minimumExperienceYears = typeof parsed.minimum_experience_years === 'number'
    ? Math.max(0, parsed.minimum_experience_years)
    : 0;

  const subjectMatterCodes: string[] = Array.isArray(parsed.subject_matter_codes)
    ? parsed.subject_matter_codes.filter((c: unknown) => typeof c === 'string')
    : [];

  const validTiers: ExpertiseTier[] = ['entry', 'intermediate', 'expert', 'specialist'];
  const expertiseTier: ExpertiseTier = validTiers.includes(parsed.expertise_tier)
    ? parsed.expertise_tier
    : 'entry';

  const countries: string[] = Array.isArray(parsed.countries)
    ? parsed.countries.map((c: unknown) => String(c).toUpperCase())
    : [];

  const languages: string[] = Array.isArray(parsed.languages)
    ? parsed.languages.map((l: unknown) => String(l).toLowerCase())
    : [];

  const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : '';

  return {
    jobClass,
    confidence,
    requirements: {
      credentials,
      minimumExperienceYears,
      subjectMatterCodes,
      expertiseTier,
      countries,
      languages,
    },
    reasoning,
  };
}

/**
 * Classify a job using LLM.
 */
export async function classifyJob(job: NormalizedJobPosting): Promise<JobClassificationResult> {
  const model = resolveCapsuleModel();
  const jobText = buildJobText(job);

  const userMessage = `Classify this job posting:\n\n${jobText}`;

  try {
    const responseText = await withRetry(
      () =>
        createTextResponse({
          model,
          messages: [
            { role: 'system', content: CLASSIFICATION_SYSTEM_MESSAGE },
            { role: 'user', content: userMessage },
          ],
          temperature: CLASSIFICATION_TEMPERATURE,
          maxOutputTokens: CLASSIFICATION_MAX_TOKENS,
        }),
      { maxAttempts: 2, baseDelayMs: 1000 }
    );

    const result = parseClassificationResponse(responseText);

    logger.info(
      {
        event: 'job.classified',
        jobId: job.jobId,
        jobClass: result.jobClass,
        confidence: result.confidence,
        expertiseTier: result.requirements.expertiseTier,
        credentials: result.requirements.credentials,
      },
      'Job classification complete'
    );

    return result;
  } catch (error) {
    logger.error(
      {
        event: 'job.classification_failed',
        jobId: job.jobId,
        error: (error as Error).message,
      },
      'Job classification failed, using fallback'
    );

    // Fallback to simple heuristics if LLM fails
    return fallbackClassification(job);
  }
}

/**
 * Simple fallback classification if LLM fails.
 */
function fallbackClassification(job: NormalizedJobPosting): JobClassificationResult {
  const text = [
    job.title,
    job.requirementsAdditional,
    job.expertiseLevel,
    job.dataSubjectMatter,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  // Check for obvious specialized signals
  const hasCredentials = /\b(md|phd|jd|pe|cpa|rn|np)\b/i.test(text);
  const hasMedical = /\b(medical|doctor|physician|clinical|healthcare)\b/i.test(text);
  const hasLegal = /\b(legal|attorney|lawyer|law)\b/i.test(text);
  const hasEngineering = /\b(engineer|engineering)\b/i.test(text) && /\b(civil|mechanical|electrical|structural)\b/i.test(text);

  // Check for obvious generic signals
  const hasGenericLabels = /\b(bounding box|transcription|tagging|basic annotation)\b/i.test(text);
  const hasEntryLevel = /\b(entry|beginner|no experience|any level)\b/i.test(text);

  const isSpecialized = hasCredentials || hasMedical || hasLegal || hasEngineering;
  const isGeneric = hasGenericLabels || hasEntryLevel;

  return {
    jobClass: isSpecialized && !isGeneric ? 'specialized' : 'generic',
    confidence: 0.5,
    requirements: {
      credentials: [],
      minimumExperienceYears: 0,
      subjectMatterCodes: [],
      expertiseTier: 'entry',
      countries: job.availableCountries.map((c) => c.toUpperCase().slice(0, 2)),
      languages: job.availableLanguages.map((l) => l.toLowerCase().slice(0, 2)),
    },
    reasoning: 'Fallback classification due to LLM error',
  };
}

/**
 * Synchronous classification for testing (uses fallback only).
 */
export function classifyJobSync(job: NormalizedJobPosting): JobClassificationResult {
  return fallbackClassification(job);
}

/**
 * Get the weight profile for a job class.
 */
export function getWeightProfile(jobClass: JobClass): { w_domain: number; w_task: number } {
  if (jobClass === 'specialized') {
    return { w_domain: 0.85, w_task: 0.15 };
  } else {
    return { w_domain: 0.3, w_task: 0.7 };
  }
}
