/**
 * User classifier service using LLM-based classification.
 * Extracts expertise tier, credentials, subject matter codes, and labeling experience
 * from user profiles to enable smart matching with jobs.
 */

import { NormalizedUserProfile } from '../utils/types';
import { createTextResponse } from './openai-responses';
import { resolveCapsuleModel } from './openai-model';
import { withRetry } from '../utils/retry';
import { logger } from '../utils/logger';

export type ExpertiseTier = 'entry' | 'intermediate' | 'expert' | 'specialist';

export interface UserClassificationResult {
  expertiseTier: ExpertiseTier;
  credentials: string[];
  subjectMatterCodes: string[];
  yearsExperience: number;
  hasLabelingExperience: boolean;
  confidence: number;
  reasoning: string;
}

const CLASSIFICATION_SYSTEM_MESSAGE = `You are a user classification system for an AI training marketplace. Your task is to analyze freelancer profiles/resumes and extract structured data for job matching.

CONTEXT: This marketplace connects freelancers to AI data labeling jobs. Jobs are classified as:
- "specialized" (requiring domain expertise like MD, PhD, senior developers)
- "generic" (basic data labeling anyone can do)

Your job is to classify USERS so we can match them appropriately.

CLASSIFICATION RULES:

1. EXPERTISE TIER (based on credentials and experience):
   - "specialist": Has advanced professional credentials (MD, PhD, JD, PE) or 10+ years specialized experience
   - "expert": Has professional certification or 5+ years domain experience
   - "intermediate": Has relevant degree or 2-5 years experience
   - "entry": New to field, no specific credentials, <2 years experience

2. CREDENTIALS: Extract any professional credentials mentioned (MD, PhD, JD, PE, CPA, RN, etc.)

3. SUBJECT MATTER CODES: Extract domains of expertise using format "domain:specialty"
   - Domains: medical, legal, finance, engineering, science, education, technology, language, creative
   - Examples: "medical:obgyn", "technology:angular", "language:slovak", "legal:corporate"

4. YEARS EXPERIENCE: Estimate total years of professional experience

5. LABELING EXPERIENCE: Does user have AI/ML data labeling experience? Look for:
   - Annotation, labeling, tagging work
   - RLHF, SFT, DPO experience
   - Work with labeling platforms (Scale AI, Labelbox, etc.)
   - AI model training or evaluation

Return ONLY valid JSON in this exact format:
{
  "expertise_tier": "entry" | "intermediate" | "expert" | "specialist",
  "credentials": ["MD", "PhD", etc] or [],
  "subject_matter_codes": ["medical:obgyn", "technology:angular", etc] or [],
  "years_experience": number or 0,
  "has_labeling_experience": true | false,
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}`;

const CLASSIFICATION_TEMPERATURE = 0.1;
const CLASSIFICATION_MAX_TOKENS = 800;

/**
 * Build the user profile text for classification.
 */
function buildUserText(profile: NormalizedUserProfile): string {
  const parts: string[] = [];

  if (profile.resumeText) {
    parts.push(`Resume/Profile:\n${profile.resumeText}`);
  }

  if (profile.workExperience.length > 0) {
    parts.push(`Work Experience:\n${profile.workExperience.join('\n')}`);
  }

  if (profile.education.length > 0) {
    parts.push(`Education:\n${profile.education.join('\n')}`);
  }

  if (profile.labelingExperience.length > 0) {
    parts.push(`Data Labeling Experience:\n${profile.labelingExperience.join('\n')}`);
  }

  if (profile.languages.length > 0) {
    parts.push(`Languages: ${profile.languages.join(', ')}`);
  }

  if (profile.country) {
    parts.push(`Country: ${profile.country}`);
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
  const validTiers: ExpertiseTier[] = ['entry', 'intermediate', 'expert', 'specialist'];
  const expertiseTier: ExpertiseTier = validTiers.includes(parsed.expertise_tier)
    ? parsed.expertise_tier
    : 'entry';

  const confidence = typeof parsed.confidence === 'number'
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0.8;

  const credentials: string[] = Array.isArray(parsed.credentials)
    ? parsed.credentials.map((c: unknown) => String(c).toUpperCase())
    : [];

  const subjectMatterCodes: string[] = Array.isArray(parsed.subject_matter_codes)
    ? parsed.subject_matter_codes.filter((c: unknown) => typeof c === 'string')
    : [];

  const yearsExperience = typeof parsed.years_experience === 'number'
    ? Math.max(0, parsed.years_experience)
    : 0;

  const hasLabelingExperience = parsed.has_labeling_experience === true;

  const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : '';

  return {
    expertiseTier,
    credentials,
    subjectMatterCodes,
    yearsExperience,
    hasLabelingExperience,
    confidence,
    reasoning,
  };
}

/**
 * Classify a user using LLM.
 */
export async function classifyUser(profile: NormalizedUserProfile): Promise<UserClassificationResult> {
  const model = resolveCapsuleModel();
  const userText = buildUserText(profile);

  const userMessage = `Classify this freelancer profile:\n\n${userText}`;

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
      { retries: 2, delaysMs: [1000, 2000] }
    );

    const result = parseClassificationResponse(responseText);

    logger.info(
      {
        event: 'user.classified',
        userId: profile.userId,
        expertiseTier: result.expertiseTier,
        credentials: result.credentials,
        subjectMatterCodes: result.subjectMatterCodes,
        hasLabelingExperience: result.hasLabelingExperience,
        confidence: result.confidence,
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

  // Check for credentials
  const hasCredentials = /\b(md|phd|jd|pe|cpa|rn|np|msn|pharmd|dds|dmd|d\.o\.)\b/i.test(text);

  // Check for labeling experience
  const hasLabelingExperience = /\b(annotation|labeling|tagging|rlhf|sft|dpo|bounding box|transcription|scale ai|labelbox|outlier)\b/i.test(text);

  // Estimate expertise tier based on signals
  let expertiseTier: ExpertiseTier = 'entry';
  if (hasCredentials) {
    expertiseTier = 'specialist';
  } else if (/\b(senior|lead|principal|staff|architect|manager|director)\b/i.test(text)) {
    expertiseTier = 'expert';
  } else if (/\b(mid|intermediate|experienced|years? experience)\b/i.test(text)) {
    expertiseTier = 'intermediate';
  }

  return {
    expertiseTier,
    credentials: [],
    subjectMatterCodes: [],
    yearsExperience: 0,
    hasLabelingExperience,
    confidence: 0.5,
    reasoning: 'Fallback classification due to LLM error',
  };
}
