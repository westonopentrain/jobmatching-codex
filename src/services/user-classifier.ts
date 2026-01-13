/**
 * User classifier service using LLM-based classification.
 * Classifies users as 'domain_expert', 'general_labeler', or 'mixed'.
 */

import { NormalizedUserProfile } from '../utils/types';
import { createTextResponse } from './openai-responses';
import { resolveCapsuleModel } from './openai-model';
import { withRetry } from '../utils/retry';
import { logger } from '../utils/logger';

export type UserClass = 'domain_expert' | 'general_labeler' | 'mixed';
export type ExpertiseTier = 'entry' | 'intermediate' | 'expert' | 'specialist';

export interface UserClassificationResult {
  userClass: UserClass;
  confidence: number;
  credentials: string[];
  domainCodes: string[];
  estimatedExperienceYears: number;
  expertiseTier: ExpertiseTier;
  hasLabelingExperience: boolean;
  taskCapabilities: string[];
  signals: string[];
}

const CLASSIFICATION_SYSTEM_MESSAGE = `You are a user classification system for an AI training marketplace. Your task is to analyze user profiles and classify them.

CLASSIFICATION RULES:
1. "domain_expert" - Users with professional credentials (MD, PhD, JD, PE, CPA) or specialized professional roles (physician, attorney, engineer, scientist, professor). These users have deep expertise in specific domains.

2. "general_labeler" - Users who primarily do data labeling/annotation work. They may have experience with platforms like Scale AI, Appen, Remotasks, Toloka, Surge AI, MTurk, Outlier AI, etc. Job titles include: data labeler, annotator, rater, transcriber, crowd worker.

3. "mixed" - Users who have BOTH domain expertise AND labeling experience. Example: A physician who also does medical content annotation for AI training.

LABELING PLATFORMS (if mentioned, indicates labeling experience):
Scale AI, Appen, Remotasks, Toloka, Surge AI, LXT, Outlier AI, Labelbox, Amazon Mechanical Turk, MTurk, Clickworker, Sama, CloudFactory, Hive, Defined.ai

TASK CAPABILITIES to detect:
bounding_box, image_classification, transcription, ner, segmentation, polygon_annotation, keypoint_annotation, sentiment_analysis, translation, summarization, prompt_writing, response_evaluation, sft, rlhf, code_review, red_teaming, evaluation, ocr, data_collection

Return ONLY valid JSON in this exact format:
{
  "user_class": "domain_expert" | "general_labeler" | "mixed",
  "confidence": 0.0-1.0,
  "credentials": ["MD", "PhD", etc] or [],
  "domain_codes": ["medical:obgyn", "legal:corporate", "engineering:civil", etc] or [],
  "estimated_experience_years": number or 0,
  "expertise_tier": "entry" | "intermediate" | "expert" | "specialist",
  "has_labeling_experience": true | false,
  "task_capabilities": ["bounding_box", "transcription", etc] or [],
  "signals": ["brief explanation of key signals detected"]
}

Domain code format: "domain:specialty" where domain is one of: medical, legal, finance, engineering, science, education, technology. If no specific specialty, use "domain:general".

Expertise tier rules:
- "specialist": PhD, or advanced credential (MD/JD) with 5+ years
- "expert": Advanced credential OR 5+ years experience
- "intermediate": Mid-level credential (MS/MBA) OR 2+ years experience
- "entry": Less than 2 years, no significant credentials`;

const CLASSIFICATION_TEMPERATURE = 0.1;
const CLASSIFICATION_MAX_TOKENS = 800;

/**
 * Build user profile text for classification.
 */
function buildUserText(profile: NormalizedUserProfile): string {
  const parts: string[] = [];

  if (profile.resumeText) {
    parts.push(`Resume:\n${profile.resumeText}`);
  }
  if (profile.workExperience.length > 0) {
    parts.push(`Work Experience:\n${profile.workExperience.join('\n')}`);
  }
  if (profile.education.length > 0) {
    parts.push(`Education:\n${profile.education.join('\n')}`);
  }
  if (profile.labelingExperience.length > 0) {
    parts.push(`Labeling Experience:\n${profile.labelingExperience.join('\n')}`);
  }
  if (profile.languages.length > 0) {
    parts.push(`Languages: ${profile.languages.join(', ')}`);
  }

  return parts.join('\n\n');
}

/**
 * Parse the LLM response into a structured result.
 */
function parseClassificationResponse(responseText: string): UserClassificationResult {
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
  const validClasses: UserClass[] = ['domain_expert', 'general_labeler', 'mixed'];
  const userClass: UserClass = validClasses.includes(parsed.user_class)
    ? parsed.user_class
    : 'general_labeler';

  const confidence = typeof parsed.confidence === 'number'
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0.5;

  const credentials: string[] = Array.isArray(parsed.credentials)
    ? parsed.credentials.map((c: unknown) => String(c).toUpperCase())
    : [];

  const domainCodes: string[] = Array.isArray(parsed.domain_codes)
    ? parsed.domain_codes.filter((c: unknown) => typeof c === 'string')
    : [];

  const estimatedExperienceYears = typeof parsed.estimated_experience_years === 'number'
    ? Math.max(0, parsed.estimated_experience_years)
    : 0;

  const validTiers: ExpertiseTier[] = ['entry', 'intermediate', 'expert', 'specialist'];
  const expertiseTier: ExpertiseTier = validTiers.includes(parsed.expertise_tier)
    ? parsed.expertise_tier
    : 'entry';

  const hasLabelingExperience = parsed.has_labeling_experience === true;

  const taskCapabilities: string[] = Array.isArray(parsed.task_capabilities)
    ? parsed.task_capabilities.filter((c: unknown) => typeof c === 'string')
    : [];

  const signals: string[] = Array.isArray(parsed.signals)
    ? parsed.signals.map((s: unknown) => String(s))
    : [];

  return {
    userClass,
    confidence: Math.round(confidence * 100) / 100,
    credentials,
    domainCodes,
    estimatedExperienceYears,
    expertiseTier,
    hasLabelingExperience,
    taskCapabilities,
    signals,
  };
}

/**
 * Classify a user using LLM.
 */
export async function classifyUser(profile: NormalizedUserProfile): Promise<UserClassificationResult> {
  const model = resolveCapsuleModel();
  const userText = buildUserText(profile);

  // Handle empty profiles
  if (!userText.trim()) {
    return {
      userClass: 'general_labeler',
      confidence: 0.5,
      credentials: [],
      domainCodes: [],
      estimatedExperienceYears: 0,
      expertiseTier: 'entry',
      hasLabelingExperience: false,
      taskCapabilities: [],
      signals: ['empty_profile'],
    };
  }

  const userMessage = `Classify this user profile:\n\n${userText}`;

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
        event: 'user.classified',
        userId: profile.userId,
        userClass: result.userClass,
        confidence: result.confidence,
        expertiseTier: result.expertiseTier,
        credentials: result.credentials,
        hasLabelingExperience: result.hasLabelingExperience,
      },
      'User classification complete'
    );

    return result;
  } catch (error) {
    logger.error(
      {
        event: 'user.classification_failed',
        userId: profile.userId,
        error: (error as Error).message,
      },
      'User classification failed, using fallback'
    );

    // Fallback to simple heuristics if LLM fails
    return fallbackClassification(profile);
  }
}

/**
 * Simple fallback classification if LLM fails.
 */
function fallbackClassification(profile: NormalizedUserProfile): UserClassificationResult {
  const text = [
    profile.resumeText,
    ...profile.workExperience,
    ...profile.education,
    ...profile.labelingExperience,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  // Check for obvious domain expert signals
  const hasCredentials = /\b(md|phd|jd|pe|cpa|rn|np)\b/i.test(text);
  const hasProfessionalRole = /\b(physician|doctor|attorney|lawyer|engineer|scientist|professor)\b/i.test(text);

  // Check for obvious labeler signals
  const hasLabelingPlatform = /\b(scale ai|appen|remotasks|toloka|surge ai|mturk|mechanical turk|outlier)\b/i.test(text);
  const hasLabelerTitle = /\b(annotator|labeler|rater|transcriber|crowd worker)\b/i.test(text);
  const hasLabelingExperienceField = profile.labelingExperience.length > 0;

  const isDomainExpert = hasCredentials || hasProfessionalRole;
  const isLabeler = hasLabelingPlatform || hasLabelerTitle || hasLabelingExperienceField;

  let userClass: UserClass;
  if (isDomainExpert && isLabeler) {
    userClass = 'mixed';
  } else if (isDomainExpert) {
    userClass = 'domain_expert';
  } else {
    userClass = 'general_labeler';
  }

  return {
    userClass,
    confidence: 0.5,
    credentials: [],
    domainCodes: [],
    estimatedExperienceYears: 0,
    expertiseTier: 'entry',
    hasLabelingExperience: isLabeler,
    taskCapabilities: [],
    signals: ['fallback_classification'],
  };
}

/**
 * Synchronous classification for testing (uses fallback only).
 */
export function classifyUserSync(profile: NormalizedUserProfile): UserClassificationResult {
  return fallbackClassification(profile);
}

/**
 * Check if a user is eligible for a specialized job based on their classification.
 */
export function isEligibleForSpecializedJob(
  userClassification: UserClassificationResult,
  requiredCredentials: string[],
  requiredDomainCodes: string[]
): boolean {
  // Must be domain expert or mixed
  if (userClassification.userClass === 'general_labeler') {
    return false;
  }

  // Check credential match (if required)
  if (requiredCredentials.length > 0) {
    const userCreds = new Set(userClassification.credentials.map((c) => c.toUpperCase()));
    const hasMatchingCredential = requiredCredentials.some((req) =>
      userCreds.has(req.toUpperCase())
    );
    if (!hasMatchingCredential) {
      return false;
    }
  }

  // Check domain code match (if required)
  if (requiredDomainCodes.length > 0) {
    const userDomains = new Set(userClassification.domainCodes);
    const hasMatchingDomain = requiredDomainCodes.some((req) => userDomains.has(req));
    if (!hasMatchingDomain) {
      // Also check for parent domain match
      const hasParentMatch = requiredDomainCodes.some((req) => {
        const [reqDomain] = req.split(':');
        return userClassification.domainCodes.some((userCode) => userCode.startsWith(`${reqDomain}:`));
      });
      if (!hasParentMatch) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Check if a user should be excluded from generic jobs (overqualified domain expert).
 */
export function shouldExcludeFromGenericJob(
  userClassification: UserClassificationResult
): boolean {
  // Pure domain experts without labeling experience should not be spammed with generic jobs
  return (
    userClassification.userClass === 'domain_expert' &&
    !userClassification.hasLabelingExperience
  );
}
