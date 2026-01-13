/**
 * User classifier service.
 * Classifies users as 'domain_expert', 'general_labeler', or 'mixed'.
 */

import { NormalizedUserProfile } from '../utils/types';
import {
  extractUserCredentials,
  extractExperienceYears,
  ExpertiseTier,
} from './requirements-extractor';
import { ADVANCED_CREDENTIALS, MID_CREDENTIALS } from '../config/subject-matter-taxonomy';
import { extractLabelingEvidence } from '../utils/evidence';
import { logger } from '../utils/logger';

export type UserClass = 'domain_expert' | 'general_labeler' | 'mixed';

export interface UserClassification {
  userClass: UserClass;
  confidence: number;
  signals: string[];
}

export interface UserClassificationResult extends UserClassification {
  credentials: string[];
  domainCodes: string[];
  estimatedExperienceYears: number;
  expertiseTier: ExpertiseTier;
  hasLabelingExperience: boolean;
  taskCapabilities: string[];
}

// Professional roles that indicate domain expertise
const PROFESSIONAL_ROLES = new Set([
  'physician',
  'doctor',
  'surgeon',
  'attorney',
  'lawyer',
  'engineer',
  'scientist',
  'researcher',
  'professor',
  'consultant',
  'specialist',
  'architect',
  'pharmacist',
  'dentist',
  'veterinarian',
  'psychologist',
  'psychiatrist',
  'radiologist',
  'cardiologist',
  'oncologist',
  'neurologist',
  'anesthesiologist',
  'pathologist',
  'dermatologist',
  'pediatrician',
  'internist',
  'accountant',
  'auditor',
  'actuary',
  'analyst',
  'investment banker',
  'trader',
]);

// Labeling platform names that indicate labeling experience
const LABELING_PLATFORMS = new Set([
  'scale ai',
  'scale',
  'appen',
  'remotasks',
  'toloka',
  'surge',
  'surge ai',
  'lxt',
  'outlier',
  'outlier ai',
  'labelbox',
  'label studio',
  'cvat',
  'superannotate',
  'prodigy',
  'doccano',
  'amazon mechanical turk',
  'mturk',
  'clickworker',
  'microworkers',
  'sama',
  'cloudfactory',
  'hive',
  'isahit',
  'playment',
  'humans in the loop',
  'defined.ai',
  'definedcrowd',
]);

// Job titles that indicate labeling work
const LABELER_TITLES = new Set([
  'data labeler',
  'annotator',
  'data annotator',
  'rater',
  'quality rater',
  'search rater',
  'ads rater',
  'crowd worker',
  'crowdworker',
  'transcriber',
  'transcriptionist',
  'tagger',
  'content moderator',
  'ai trainer',
  'data trainer',
  'machine learning trainer',
  'ml trainer',
]);

// Task capabilities that can be extracted from profiles
const TASK_CAPABILITY_PATTERNS: Array<{ pattern: RegExp; capability: string }> = [
  { pattern: /bounding\s*box/i, capability: 'bounding_box' },
  { pattern: /image\s*classification/i, capability: 'image_classification' },
  { pattern: /transcription/i, capability: 'transcription' },
  { pattern: /\bner\b|named\s*entity/i, capability: 'ner' },
  { pattern: /segmentation/i, capability: 'segmentation' },
  { pattern: /polygon/i, capability: 'polygon_annotation' },
  { pattern: /keypoint/i, capability: 'keypoint_annotation' },
  { pattern: /sentiment/i, capability: 'sentiment_analysis' },
  { pattern: /translation/i, capability: 'translation' },
  { pattern: /summarization/i, capability: 'summarization' },
  { pattern: /prompt\s*(?:writing|engineering)/i, capability: 'prompt_writing' },
  { pattern: /response\s*(?:writing|rating|evaluation)/i, capability: 'response_evaluation' },
  { pattern: /sft|supervised\s*fine[\s-]*tuning/i, capability: 'sft' },
  { pattern: /rlhf|reinforcement\s*learning/i, capability: 'rlhf' },
  { pattern: /code\s*(?:review|annotation)/i, capability: 'code_review' },
  { pattern: /red[\s-]*team/i, capability: 'red_teaming' },
  { pattern: /evaluation|rating|scoring/i, capability: 'evaluation' },
  { pattern: /ocr/i, capability: 'ocr' },
  { pattern: /data\s*collection/i, capability: 'data_collection' },
];

/**
 * Extract task capabilities from profile text.
 */
function extractTaskCapabilities(text: string): string[] {
  const capabilities: string[] = [];

  for (const { pattern, capability } of TASK_CAPABILITY_PATTERNS) {
    if (pattern.test(text)) {
      if (!capabilities.includes(capability)) {
        capabilities.push(capability);
      }
    }
  }

  return capabilities;
}

/**
 * Check if text contains labeling platform mentions.
 * Uses word boundaries to avoid false positives (e.g., "surgeon" matching "surge").
 */
function hasLabelingPlatformExperience(text: string): boolean {
  const lower = text.toLowerCase();
  return Array.from(LABELING_PLATFORMS).some((platform) => {
    // Use word boundary regex to avoid substring matches
    const regex = new RegExp(`\\b${escapeRegex(platform)}\\b`, 'i');
    return regex.test(lower);
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check if text contains labeler job titles.
 */
function hasLabelerTitle(text: string): boolean {
  const lower = text.toLowerCase();
  return Array.from(LABELER_TITLES).some((title) => lower.includes(title));
}

/**
 * Check if text contains professional role mentions.
 */
function hasProfessionalRole(text: string): boolean {
  const lower = text.toLowerCase();
  // Use word boundaries to avoid false positives
  return Array.from(PROFESSIONAL_ROLES).some((role) => {
    const regex = new RegExp(`\\b${role}\\b`, 'i');
    return regex.test(lower);
  });
}

/**
 * Determine expertise tier for a user based on credentials and experience.
 */
function determineUserExpertiseTier(
  credentials: string[],
  experienceYears: number
): ExpertiseTier {
  const hasAdvanced = credentials.some((c) => ADVANCED_CREDENTIALS.has(c.toUpperCase()));
  const hasMid = credentials.some((c) => MID_CREDENTIALS.has(c.toUpperCase()));

  if (hasAdvanced && experienceYears >= 10) {
    return 'specialist';
  }
  if (hasAdvanced || experienceYears >= 5) {
    return 'expert';
  }
  if (hasMid || experienceYears >= 2) {
    return 'intermediate';
  }
  return 'entry';
}

/**
 * Classify a user as domain expert, general labeler, or mixed.
 */
export function classifyUser(profile: NormalizedUserProfile): UserClassificationResult {
  const signals: string[] = [];
  let expertScore = 0;
  let labelerScore = 0;

  // Combine all text sources for analysis
  const fullText = [
    profile.resumeText,
    ...profile.workExperience,
    ...profile.education,
    ...profile.labelingExperience,
  ].join('\n');

  // Extract credentials and experience
  const { credentials, estimatedExperienceYears, domainCodes } = extractUserCredentials(fullText);

  // Signal 1: Professional credentials
  const hasAdvancedCredential = credentials.some((c) => ADVANCED_CREDENTIALS.has(c.toUpperCase()));
  const hasMidCredential = credentials.some((c) => MID_CREDENTIALS.has(c.toUpperCase()));

  if (hasAdvancedCredential) {
    expertScore += 4;
    const advancedCreds = credentials.filter((c) => ADVANCED_CREDENTIALS.has(c.toUpperCase()));
    signals.push(`advanced_credentials:${advancedCreds.join(',')}`);
  }
  if (hasMidCredential) {
    expertScore += 2;
    const midCreds = credentials.filter((c) => MID_CREDENTIALS.has(c.toUpperCase()));
    signals.push(`mid_credentials:${midCreds.join(',')}`);
  }

  // Signal 2: Professional roles in experience
  if (hasProfessionalRole(fullText)) {
    expertScore += 2;
    signals.push('professional_role_detected');
  }

  // Signal 3: Labeling evidence from our existing extractor
  const labelingEvidence = extractLabelingEvidence(fullText);
  const hasLabelingEvidenceFromExtractor =
    labelingEvidence.tokens.length > 0 || labelingEvidence.phrases.length > 0;

  if (hasLabelingEvidenceFromExtractor) {
    labelerScore += 2;
    signals.push('labeling_evidence_detected');
  }

  // Signal 4: Labeling platform experience
  if (hasLabelingPlatformExperience(fullText)) {
    labelerScore += 3;
    signals.push('labeling_platform_experience');
  }

  // Signal 5: Labeler job titles
  if (hasLabelerTitle(fullText)) {
    labelerScore += 3;
    signals.push('labeler_title_detected');
  }

  // Signal 6: Explicit labeling experience field provided
  if (profile.labelingExperience.length > 0) {
    const labelingText = profile.labelingExperience.join(' ');
    if (labelingText.trim().length > 20) {
      // Meaningful labeling experience
      labelerScore += 2;
      signals.push('labeling_experience_field_populated');
    }
  }

  // Signal 7: Domain codes detected
  if (domainCodes.length > 0) {
    expertScore += 1;
    signals.push(`domain_codes:${domainCodes.slice(0, 3).join(',')}`);
  }

  // Signal 8: Experience years
  if (estimatedExperienceYears >= 10) {
    expertScore += 2;
    signals.push(`experience:${estimatedExperienceYears}yr`);
  } else if (estimatedExperienceYears >= 5) {
    expertScore += 1;
    signals.push(`experience:${estimatedExperienceYears}yr`);
  }

  // Extract task capabilities
  const taskCapabilities = extractTaskCapabilities(fullText);
  if (taskCapabilities.length > 0) {
    labelerScore += 1;
    signals.push(`task_capabilities:${taskCapabilities.slice(0, 3).join(',')}`);
  }

  // Determine expertise tier
  const expertiseTier = determineUserExpertiseTier(credentials, estimatedExperienceYears);

  // Determine labeling experience
  const hasLabelingExperience =
    hasLabelingEvidenceFromExtractor ||
    hasLabelingPlatformExperience(fullText) ||
    hasLabelerTitle(fullText) ||
    profile.labelingExperience.length > 0;

  // Decision: Users can be "mixed" if they have both expert and labeler signals
  let userClass: UserClass;
  const totalScore = expertScore + labelerScore;
  let confidence: number;

  if (expertScore >= 4 && labelerScore >= 3) {
    // Strong signals for both - this is a domain expert who also does labeling
    userClass = 'mixed';
    confidence = Math.min(expertScore, labelerScore) / Math.max(totalScore, 1);
    signals.push('classification:mixed_both_signals_strong');
  } else if (expertScore > labelerScore && expertScore >= 3) {
    // Primarily a domain expert
    userClass = 'domain_expert';
    confidence = expertScore / Math.max(totalScore, 1);
  } else if (labelerScore > 0) {
    // Has labeling experience
    userClass = 'general_labeler';
    confidence = labelerScore / Math.max(totalScore, 1);
  } else {
    // Default to general labeler if no strong signals
    userClass = 'general_labeler';
    confidence = 0.5;
    signals.push('classification:default_no_strong_signals');
  }

  // Log classification for debugging
  logger.debug(
    {
      event: 'user.classified',
      userId: profile.userId,
      userClass,
      confidence,
      expertScore,
      labelerScore,
      signals,
    },
    'User classification complete'
  );

  return {
    userClass,
    confidence: Math.round(confidence * 100) / 100,
    signals,
    credentials,
    domainCodes,
    estimatedExperienceYears,
    expertiseTier,
    hasLabelingExperience,
    taskCapabilities,
  };
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
