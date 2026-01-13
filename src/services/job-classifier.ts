/**
 * Job classifier service.
 * Classifies jobs as 'specialized' (requiring domain expertise) or 'generic' (basic labeling tasks).
 */

import { NormalizedJobPosting } from '../utils/types';
import {
  extractJobRequirements,
  extractCredentials,
  ExpertiseTier,
} from './requirements-extractor';
import {
  SPECIALIZED_DOMAINS,
  GENERIC_TASK_TYPES,
  isSpecializedDomain,
} from '../config/subject-matter-taxonomy';
import { logger } from '../utils/logger';

export type JobClass = 'specialized' | 'generic';

export interface JobClassification {
  jobClass: JobClass;
  confidence: number;
  signals: string[];
}

export interface JobClassificationResult extends JobClassification {
  requirements: {
    credentials: string[];
    minimumExperienceYears: number;
    subjectMatterCodes: string[];
    expertiseTier: ExpertiseTier;
    countries: string[];
    languages: string[];
  };
}

// Specialized domain keywords
const SPECIALIZED_SUBJECT_MATTERS = new Set([
  'medical',
  'healthcare',
  'clinical',
  'pharmaceutical',
  'legal',
  'law',
  'financial',
  'accounting',
  'engineering',
  'scientific',
  'research',
  'physician',
  'doctor',
  'attorney',
  'lawyer',
  'nurse',
  'pharmacist',
  'dentist',
  'veterinary',
]);

// Generic label types that indicate basic work
const GENERIC_LABEL_TYPES = new Set([
  'bounding box',
  'bounding boxes',
  'bbox',
  'image classification',
  'transcription',
  'audio transcription',
  'speech transcription',
  'segmentation',
  'polygon',
  'keypoints',
  'keypoint annotation',
  'data collection',
  'basic annotation',
  'simple annotation',
  'tagging',
  'image tagging',
  'video tagging',
]);

// Specialized label types that indicate expert work
const SPECIALIZED_LABEL_TYPES = new Set([
  'evaluation',
  'rating',
  'expert review',
  'prompt writing',
  'response assessment',
  'quality rating',
  'response writing',
  'sft',
  'prompt + response writing',
  'medical annotation',
  'legal review',
  'code review',
]);

/**
 * Classify a job as specialized or generic based on multiple signals.
 */
export function classifyJob(job: NormalizedJobPosting): JobClassificationResult {
  const signals: string[] = [];
  let specializedScore = 0;
  let genericScore = 0;

  // Extract requirements for additional context
  const requirements = extractJobRequirements(job);

  // Signal 1: ExpertiseLevel field
  const expertiseLevel = (job.expertiseLevel ?? '').toLowerCase();
  if (/specialist|expert|advanced|senior|professional|md|phd|jd/.test(expertiseLevel)) {
    specializedScore += 3;
    signals.push(`expertise_level:specialized(${expertiseLevel})`);
  } else if (/beginner|entry|basic|no experience|any level|less than 1 year/.test(expertiseLevel)) {
    genericScore += 3;
    signals.push(`expertise_level:generic(${expertiseLevel})`);
  } else if (/intermediate|some experience/.test(expertiseLevel)) {
    // Neutral - could be either
    genericScore += 1;
    signals.push(`expertise_level:intermediate`);
  }

  // Signal 2: Requirements_Additional contains credential requirements
  const requirementsText = (job.requirementsAdditional ?? '').toLowerCase();
  const credentialMatches = extractCredentials(job.requirementsAdditional ?? '');
  if (credentialMatches.length > 0) {
    specializedScore += 4;
    signals.push(`credentials_required:${credentialMatches.join(',')}`);
  }

  // Check for hard requirement language
  if (requirements.hasHardCredentialRequirement) {
    specializedScore += 2;
    signals.push('hard_credential_requirement');
  }

  // Signal 3: Data_SubjectMatter indicates specialized domain
  const subjectMatter = (job.dataSubjectMatter ?? '').toLowerCase();
  const subjectMatches = Array.from(SPECIALIZED_SUBJECT_MATTERS).filter((term) =>
    subjectMatter.includes(term)
  );
  if (subjectMatches.length > 0) {
    specializedScore += 2;
    signals.push(`subject_matter:${subjectMatches.join(',')}`);
  }

  // Check if domain codes are specialized
  for (const code of requirements.subjectMatterCodes) {
    if (isSpecializedDomain(code)) {
      specializedScore += 2;
      signals.push(`specialized_domain:${code}`);
      break; // Only count once
    }
  }

  // Signal 4: LabelTypes indicates type of work
  const labelTypes = job.labelTypes.map((lt) => lt.toLowerCase());

  // Check for generic label types
  const genericMatches = labelTypes.filter(
    (lt) =>
      Array.from(GENERIC_LABEL_TYPES).some((generic) => lt.includes(generic)) ||
      Array.from(GENERIC_TASK_TYPES).some((generic) => lt.includes(generic))
  );
  if (genericMatches.length > 0) {
    genericScore += 2;
    signals.push(`label_type:generic(${genericMatches.join(',')})`);
  }

  // Check for specialized label types
  const specializedLabelMatches = labelTypes.filter((lt) =>
    Array.from(SPECIALIZED_LABEL_TYPES).some((spec) => lt.includes(spec))
  );
  if (specializedLabelMatches.length > 0) {
    specializedScore += 2;
    signals.push(`label_type:specialized(${specializedLabelMatches.join(',')})`);
  }

  // Signal 5: Check for experience/residency/fellowship requirements in combined text
  const combinedText = [
    job.instructions,
    job.requirementsAdditional,
    job.workloadDesc,
    job.datasetDescription,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/residency|fellowship|board[\s-]?certif/.test(combinedText)) {
    specializedScore += 3;
    signals.push('residency_or_fellowship_required');
  }

  if (/years? (of )?experience|practicing|clinical experience/.test(combinedText)) {
    if (requirements.minimumExperienceYears >= 3) {
      specializedScore += 2;
      signals.push(`experience_required:${requirements.minimumExperienceYears}yr`);
    }
  }

  // Signal 6: Title indicates specialized role
  const title = (job.title ?? '').toLowerCase();
  if (/doctor|physician|attorney|lawyer|engineer|scientist|specialist|expert/.test(title)) {
    specializedScore += 2;
    signals.push('title_indicates_specialist');
  }
  if (/annotator|labeler|rater|transcriber|tagger/.test(title)) {
    genericScore += 2;
    signals.push('title_indicates_labeler');
  }

  // Signal 7: Expertise tier from requirements
  if (requirements.expertiseTier === 'specialist') {
    specializedScore += 2;
    signals.push('expertise_tier:specialist');
  } else if (requirements.expertiseTier === 'expert') {
    specializedScore += 1;
    signals.push('expertise_tier:expert');
  } else if (requirements.expertiseTier === 'entry') {
    genericScore += 2;
    signals.push('expertise_tier:entry');
  }

  // Decision logic
  const totalScore = specializedScore + genericScore;
  const confidence =
    totalScore > 0 ? Math.abs(specializedScore - genericScore) / totalScore : 0.5;

  const jobClass: JobClass = specializedScore > genericScore ? 'specialized' : 'generic';

  // Log classification for debugging
  logger.debug(
    {
      event: 'job.classified',
      jobId: job.jobId,
      jobClass,
      confidence,
      specializedScore,
      genericScore,
      signals,
    },
    'Job classification complete'
  );

  return {
    jobClass,
    confidence: Math.round(confidence * 100) / 100,
    signals,
    requirements: {
      credentials: requirements.credentials,
      minimumExperienceYears: requirements.minimumExperienceYears,
      subjectMatterCodes: requirements.subjectMatterCodes,
      expertiseTier: requirements.expertiseTier,
      countries: requirements.countries,
      languages: requirements.languages,
    },
  };
}

/**
 * Get the weight profile for a job class.
 */
export function getWeightProfile(jobClass: JobClass): { w_domain: number; w_task: number } {
  if (jobClass === 'specialized') {
    // Domain expertise is critical for specialized jobs
    return { w_domain: 0.85, w_task: 0.15 };
  } else {
    // Task/labeling experience is more important for generic jobs
    return { w_domain: 0.3, w_task: 0.7 };
  }
}
