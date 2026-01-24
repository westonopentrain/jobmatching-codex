/**
 * Language matching utilities.
 *
 * Jobs often have two types of language requirements:
 * 1. Work languages (Polish, Korean, etc.) - the actual language needed to do the job
 * 2. Communication language (English) - added by default for instructions/communication
 *
 * This module provides logic to properly match users to jobs based on work languages,
 * treating English as a communication default rather than a work requirement.
 */

/**
 * Extract work languages from a job's language list (excludes English).
 */
export function getWorkLanguages(jobLanguages: string[]): string[] {
  return jobLanguages.filter((l) => l.toLowerCase() !== 'english');
}

/**
 * Check if a user's languages match a job's language requirements.
 *
 * Logic:
 * - If job has non-English work languages, user must speak at least one
 * - If job only has English (or no languages), English speakers match
 *
 * @param jobLanguages - Languages required by the job
 * @param userLanguages - Languages the user speaks
 * @returns true if user matches the job's language requirements
 */
export function matchesJobLanguages(
  jobLanguages: string[],
  userLanguages: string[]
): boolean {
  // No job language requirements - anyone matches
  if (jobLanguages.length === 0) {
    return true;
  }

  // User has no languages set - can't match any language-specific job
  if (userLanguages.length === 0) {
    return false;
  }

  const userLanguagesLower = new Set(userLanguages.map((l) => l.toLowerCase()));
  const workLanguages = getWorkLanguages(jobLanguages);

  if (workLanguages.length > 0) {
    // Job has non-English work languages - user must speak at least one
    return workLanguages.some((l) => userLanguagesLower.has(l.toLowerCase()));
  } else {
    // Job only requires English - English speakers match
    return userLanguagesLower.has('english');
  }
}

/**
 * Get the languages to filter by for Pinecone queries.
 *
 * Returns the work languages (non-English) if any exist, otherwise returns ['English'].
 * This is used to build the $in filter for Pinecone vector queries.
 *
 * @param jobLanguages - Languages required by the job
 * @returns Languages to use in the Pinecone filter
 */
export function getLanguageFilterForPinecone(jobLanguages: string[]): string[] {
  const workLanguages = getWorkLanguages(jobLanguages);

  if (workLanguages.length > 0) {
    // User must speak at least one of the work languages
    return workLanguages;
  } else {
    // Job only requires English - match English speakers
    return ['English'];
  }
}
