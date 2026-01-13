/**
 * Extract structured requirements from job postings.
 * Parses credentials, experience years, and other hard requirements.
 */

import {
  mapToSubjectMatterCodes,
  ADVANCED_CREDENTIALS,
  MID_CREDENTIALS,
  CREDENTIAL_DOMAIN_MAP,
} from '../config/subject-matter-taxonomy';
import { NormalizedJobPosting } from '../utils/types';

export type ExpertiseTier = 'entry' | 'intermediate' | 'expert' | 'specialist';

export interface ExtractedRequirements {
  credentials: string[];
  minimumExperienceYears: number;
  subjectMatterCodes: string[];
  expertiseTier: ExpertiseTier;
  countries: string[];
  languages: string[];
  hasHardCredentialRequirement: boolean;
}

// Credential terms to detect in text
const CREDENTIAL_TERMS = [
  'MD',
  'DO',
  'RN',
  'NP',
  'PA',
  'JD',
  'LLM',
  'LLB',
  'DDS',
  'DMD',
  'DVM',
  'PhD',
  'Ph.D',
  'PharmD',
  'MBA',
  'MPH',
  'MSN',
  'MS',
  'BSN',
  'BS',
  'BA',
  'CPA',
  'CFA',
  'CFP',
  'CMA',
  'CISA',
  'CISM',
  'CISSP',
  'PMP',
  'PE',
  'MRCOG',
  'FACS',
  'FACC',
  'ABOG',
];

// Patterns that indicate hard credential requirements
const HARD_REQUIREMENT_PATTERNS = [
  /must\s+(?:have|hold|possess|be)\s+(?:a|an)?\s*(?:valid\s+)?(\w+)/gi,
  /required?:\s*(\w+)/gi,
  /(\w+)\s+(?:degree|certification|license)\s+required/gi,
  /(?:requires?|requiring)\s+(?:a|an)?\s*(\w+)/gi,
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract credential mentions from text.
 */
export function extractCredentials(text: string): string[] {
  if (!text) return [];

  const found = new Set<string>();

  // Build regex for credential terms
  const credentialRegex = new RegExp(
    `\\b(${CREDENTIAL_TERMS.map(escapeRegex).join('|')})\\b`,
    'gi'
  );

  let match: RegExpExecArray | null;
  while ((match = credentialRegex.exec(text)) !== null) {
    const credential = match[1];
    if (credential) {
      // Normalize to uppercase
      found.add(credential.toUpperCase());
    }
  }

  // Also check for written-out forms
  if (/\bmedical\s+doctor\b/i.test(text) || /\bdoctor\s+of\s+medicine\b/i.test(text)) {
    found.add('MD');
  }
  if (/\bdoctor\s+of\s+osteopathic/i.test(text)) {
    found.add('DO');
  }
  if (/\bjuris\s+doctor\b/i.test(text) || /\blaw\s+degree\b/i.test(text)) {
    found.add('JD');
  }
  if (/\bdoctor\s+of\s+philosophy\b/i.test(text) || /\bdoctorate\b/i.test(text)) {
    found.add('PHD');
  }
  if (/\bregistered\s+nurse\b/i.test(text)) {
    found.add('RN');
  }
  if (/\bnurse\s+practitioner\b/i.test(text)) {
    found.add('NP');
  }
  if (/\bphysician\s+assistant\b/i.test(text)) {
    found.add('PA');
  }
  if (/\bcertified\s+public\s+accountant\b/i.test(text)) {
    found.add('CPA');
  }
  if (/\bprofessional\s+engineer\b/i.test(text)) {
    found.add('PE');
  }
  if (/\bboard[\s-]?certif/i.test(text)) {
    found.add('BOARD_CERTIFIED');
  }

  return Array.from(found);
}

/**
 * Extract minimum experience years from text.
 */
export function extractExperienceYears(text: string): number {
  if (!text) return 0;

  const patterns = [
    // "minimum of X years"
    /minimum\s+(?:of\s+)?(\d+)\s*(?:\+)?\s*years?/gi,
    // "at least X years"
    /at\s+least\s+(\d+)\s*(?:\+)?\s*years?/gi,
    // "X+ years of experience" or "X+ years of [word] experience"
    /(\d+)\s*\+?\s*years?\s+(?:of\s+)?(?:\w+\s+)?(?:experience|practicing|clinical)/gi,
    // "X+ years of professional experience"
    /(\d+)\s*\+?\s*years?\s+of\s+(?:professional|industry|work)\s+experience/gi,
    // "X years experience required"
    /(\d+)\s*years?\s+(?:of\s+)?experience\s+required/gi,
    // "requires X years"
    /require[sd]?\s+(\d+)\s*(?:\+)?\s*years?/gi,
    // "over X years"
    /over\s+(\d+)\s*years?/gi,
    // "X-Y years" (take minimum)
    /(\d+)\s*[-–]\s*\d+\s*years?/gi,
    // "X+ years post-PhD" or "X years post-doc"
    /(\d+)\s*\+?\s*years?\s+post[\s-]?(?:phd|doc|doctoral)/gi,
    // Simply "X+ years" at word boundary (more permissive)
    /\b(\d+)\s*\+\s*years?\b/gi,
  ];

  let maxRequired = 0;

  for (const pattern of patterns) {
    pattern.lastIndex = 0; // Reset regex state
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const years = parseInt(match[1]!, 10);
      if (!isNaN(years) && years > maxRequired && years <= 50) {
        maxRequired = years;
      }
    }
  }

  return maxRequired;
}

/**
 * Determine expertise tier based on job requirements.
 */
export function determineExpertiseTier(
  expertiseLevel?: string,
  experienceYears?: number,
  credentials?: string[]
): ExpertiseTier {
  const level = (expertiseLevel ?? '').toLowerCase();

  // Check for explicit tier markers in expertise level
  if (/specialist|senior|advanced/.test(level)) {
    return 'specialist';
  }
  if (/expert|experienced|professional/.test(level)) {
    return 'expert';
  }
  if (/intermediate|some\s+experience|junior|mid[\s-]?level/.test(level)) {
    return 'intermediate';
  }
  if (/entry|beginner|no\s+experience|any\s+level|less\s+than\s+1/.test(level)) {
    return 'entry';
  }

  // Check for PhD requirement - always specialist level
  if (/phd\s+required|requires?\s+(?:a\s+)?phd|phd\s+or\s+master/i.test(level)) {
    return 'specialist';
  }

  // Infer from credentials first (PhD = specialist, MD/JD = expert)
  if (credentials && credentials.length > 0) {
    const hasPhD = credentials.some((c) => ['PHD', 'PH.D'].includes(c.toUpperCase()));
    if (hasPhD) {
      return 'specialist';
    }
    const hasAdvanced = credentials.some((c) => ADVANCED_CREDENTIALS.has(c.toUpperCase()));
    if (hasAdvanced) {
      // MD/JD with 5+ years = specialist, otherwise expert
      if (experienceYears && experienceYears >= 5) {
        return 'specialist';
      }
      return 'expert';
    }
    const hasMid = credentials.some((c) => MID_CREDENTIALS.has(c.toUpperCase()));
    if (hasMid) {
      return 'intermediate';
    }
  }

  // Infer from experience years
  if (experienceYears && experienceYears >= 10) {
    return 'specialist';
  }
  if (experienceYears && experienceYears >= 5) {
    return 'expert';
  }
  if (experienceYears && experienceYears >= 2) {
    return 'intermediate';
  }

  return 'entry';
}

/**
 * Check if job has hard credential requirements (must have specific credentials).
 */
export function hasHardCredentialRequirement(text: string): boolean {
  if (!text) return false;

  const lower = text.toLowerCase();

  // Check for explicit requirement language
  const requirementIndicators = [
    /must\s+(?:have|hold|possess|be)/i,
    /required?:\s*\w+/i,
    /\w+\s+(?:degree|certification|license)\s+required/i,
    /require[sd]?\s+(?:a|an)?\s*(?:valid\s+)?(?:md|jd|phd|rn|cpa|pe)/i,
    /board[\s-]?certif(?:ied|ication)\s+required/i,
    /licensed?\s+(?:physician|attorney|nurse|doctor)/i,
    /completed?\s+residency/i,
  ];

  return requirementIndicators.some((pattern) => pattern.test(lower));
}

/**
 * Normalize country names to codes.
 */
function normalizeCountries(countries: string[]): string[] {
  const countryMap: Record<string, string> = {
    usa: 'US',
    'united states': 'US',
    'united states of america': 'US',
    us: 'US',
    uk: 'GB',
    'united kingdom': 'GB',
    britain: 'GB',
    'great britain': 'GB',
    england: 'GB',
    canada: 'CA',
    australia: 'AU',
    india: 'IN',
    philippines: 'PH',
    germany: 'DE',
    france: 'FR',
    spain: 'ES',
    italy: 'IT',
    brazil: 'BR',
    mexico: 'MX',
    japan: 'JP',
    china: 'CN',
    singapore: 'SG',
    ireland: 'IE',
    'new zealand': 'NZ',
    netherlands: 'NL',
    sweden: 'SE',
    norway: 'NO',
    denmark: 'DK',
    finland: 'FI',
    switzerland: 'CH',
    austria: 'AT',
    belgium: 'BE',
    portugal: 'PT',
    poland: 'PL',
    'south africa': 'ZA',
    kenya: 'KE',
    nigeria: 'NG',
    egypt: 'EG',
    israel: 'IL',
    'united arab emirates': 'AE',
    uae: 'AE',
    'saudi arabia': 'SA',
    pakistan: 'PK',
    bangladesh: 'BD',
    vietnam: 'VN',
    thailand: 'TH',
    indonesia: 'ID',
    malaysia: 'MY',
    'south korea': 'KR',
    korea: 'KR',
    taiwan: 'TW',
    'hong kong': 'HK',
  };

  const normalized: string[] = [];

  for (const country of countries) {
    const lower = country.toLowerCase().trim();
    const code = countryMap[lower];
    if (code && !normalized.includes(code)) {
      normalized.push(code);
    } else if (country.length === 2 && !normalized.includes(country.toUpperCase())) {
      // Already a code
      normalized.push(country.toUpperCase());
    }
  }

  return normalized;
}

/**
 * Normalize language names.
 */
function normalizeLanguages(languages: string[]): string[] {
  const languageMap: Record<string, string> = {
    english: 'en',
    spanish: 'es',
    french: 'fr',
    german: 'de',
    italian: 'it',
    portuguese: 'pt',
    chinese: 'zh',
    mandarin: 'zh',
    cantonese: 'zh',
    japanese: 'ja',
    korean: 'ko',
    arabic: 'ar',
    hindi: 'hi',
    russian: 'ru',
    dutch: 'nl',
    swedish: 'sv',
    norwegian: 'no',
    danish: 'da',
    finnish: 'fi',
    polish: 'pl',
    turkish: 'tr',
    hebrew: 'he',
    thai: 'th',
    vietnamese: 'vi',
    indonesian: 'id',
    malay: 'ms',
    tagalog: 'tl',
    filipino: 'tl',
  };

  const normalized: string[] = [];

  for (const language of languages) {
    const lower = language.toLowerCase().trim();
    const code = languageMap[lower];
    if (code && !normalized.includes(code)) {
      normalized.push(code);
    } else if (language.length === 2 && !normalized.includes(language.toLowerCase())) {
      normalized.push(language.toLowerCase());
    }
  }

  return normalized;
}

/**
 * Extract all requirements from a normalized job posting.
 */
export function extractJobRequirements(job: NormalizedJobPosting): ExtractedRequirements {
  // Combine all text sources for extraction
  const combinedText = [
    job.title,
    job.requirementsAdditional,
    job.expertiseLevel,
    job.instructions,
    job.datasetDescription,
    job.workloadDesc,
  ]
    .filter(Boolean)
    .join('\n');

  // Extract credentials mentioned in requirements
  const credentials = extractCredentials(combinedText);

  // Extract minimum experience years
  const minimumExperienceYears = extractExperienceYears(combinedText);

  // Map subject matter to standardized codes
  const subjectMatterCodes = mapToSubjectMatterCodes(job.dataSubjectMatter);

  // Also add domain codes from credentials
  for (const credential of credentials) {
    const domainCodes = CREDENTIAL_DOMAIN_MAP[credential] ?? [];
    for (const code of domainCodes) {
      if (!subjectMatterCodes.includes(code)) {
        subjectMatterCodes.push(code);
      }
    }
  }

  // Determine expertise tier
  const expertiseTier = determineExpertiseTier(
    job.expertiseLevel,
    minimumExperienceYears,
    credentials
  );

  // Normalize countries and languages
  const countries = normalizeCountries(job.availableCountries);
  const languages = normalizeLanguages(job.availableLanguages);

  // Check for hard credential requirement
  const hasHardReq = hasHardCredentialRequirement(combinedText);

  return {
    credentials,
    minimumExperienceYears,
    subjectMatterCodes,
    expertiseTier,
    countries,
    languages,
    hasHardCredentialRequirement: hasHardReq,
  };
}

/**
 * Extract credentials and experience from user profile text.
 */
export function extractUserCredentials(profileText: string): {
  credentials: string[];
  estimatedExperienceYears: number;
  domainCodes: string[];
} {
  const credentials = extractCredentials(profileText);
  const estimatedExperienceYears = extractExperienceYears(profileText);

  // Derive domain codes from credentials
  const domainCodes: string[] = [];
  for (const credential of credentials) {
    const codes = CREDENTIAL_DOMAIN_MAP[credential] ?? [];
    for (const code of codes) {
      if (!domainCodes.includes(code)) {
        domainCodes.push(code);
      }
    }
  }

  // Also extract domain codes from the text itself
  const textDomainCodes = mapToSubjectMatterCodes(profileText);
  for (const code of textDomainCodes) {
    if (!domainCodes.includes(code)) {
      domainCodes.push(code);
    }
  }

  return {
    credentials,
    estimatedExperienceYears,
    domainCodes,
  };
}
