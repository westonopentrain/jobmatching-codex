import { embedText } from './embeddings';
import type { SubjectMatterStrictness } from './job-classifier';

// In-memory cache: specialty → embedding vector
const embeddingCache = new Map<string, number[]>();

// Result of semantic matching with detailed info for debugging
export interface SemanticMatchResult {
  hasMatch: boolean;
  bestSimilarity: number;
  bestPair: { userCode: string; jobCode: string } | null;
  userCodes: string[];
}

// Threshold mapping for subject matter strictness levels
const STRICTNESS_THRESHOLDS: Record<SubjectMatterStrictness, number> = {
  strict: 0.80,   // Medical, legal, safety-critical - exact expertise required
  moderate: 0.70, // Technical fields - related expertise acceptable
  lenient: 0.60,  // General annotation - broad expertise acceptable
};

/**
 * Get the similarity threshold for a given strictness level.
 * @param strictness - The strictness level from job classification
 * @returns The threshold value (0.60 - 0.80)
 */
export function getThresholdForStrictness(
  strictness: SubjectMatterStrictness | undefined
): number {
  if (!strictness || !(strictness in STRICTNESS_THRESHOLDS)) {
    return STRICTNESS_THRESHOLDS.moderate; // Default to moderate (0.70)
  }
  return STRICTNESS_THRESHOLDS[strictness];
}

// Extract specialty from code (e.g., "science:phonetics" → "phonetics")
function extractSpecialty(code: string): string {
  return code.split(':')[1] ?? code;
}

// Get or create embedding for a specialty
export async function getSpecialtyEmbedding(code: string): Promise<number[]> {
  const specialty = extractSpecialty(code).toLowerCase();

  if (embeddingCache.has(specialty)) {
    return embeddingCache.get(specialty)!;
  }

  // Embed with context for better semantic understanding
  const embedding = await embedText(`subject matter expertise: ${specialty}`);
  embeddingCache.set(specialty, embedding);
  return embedding;
}

// Cosine similarity (vectors are normalized by OpenAI)
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
  }
  return dot;
}

// Default similarity threshold for semantic matching (used when strictness not specified)
const DEFAULT_SIMILARITY_THRESHOLD = 0.70;

// Check if two codes match semantically
export async function codesMatchSemantically(
  userCode: string,
  jobCode: string,
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD
): Promise<boolean> {
  const [userEmb, jobEmb] = await Promise.all([
    getSpecialtyEmbedding(userCode),
    getSpecialtyEmbedding(jobCode),
  ]);

  const similarity = cosineSimilarity(userEmb, jobEmb);
  return similarity >= threshold;
}

// Batch check: does user have ANY code matching ANY job code?
export async function hasMatchingSubjectMatterCode(
  userCodes: string[],
  jobCodes: string[],
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD
): Promise<boolean> {
  if (userCodes.length === 0 || jobCodes.length === 0) {
    return false;
  }

  // Pre-fetch all embeddings in parallel
  const [userEmbeddings, jobEmbeddings] = await Promise.all([
    Promise.all(userCodes.map(getSpecialtyEmbedding)),
    Promise.all(jobCodes.map(getSpecialtyEmbedding)),
  ]);

  // Check all pairs
  for (const userEmb of userEmbeddings) {
    for (const jobEmb of jobEmbeddings) {
      if (cosineSimilarity(userEmb, jobEmb) >= threshold) {
        return true;
      }
    }
  }
  return false;
}

// Get detailed match information for debugging/audit
export async function getSemanticMatchDetails(
  userCodes: string[],
  jobCodes: string[],
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD
): Promise<SemanticMatchResult> {
  if (userCodes.length === 0) {
    return {
      hasMatch: false,
      bestSimilarity: 0,
      bestPair: null,
      userCodes: [],
    };
  }

  if (jobCodes.length === 0) {
    return {
      hasMatch: true, // No job codes means no filtering required
      bestSimilarity: 1,
      bestPair: null,
      userCodes,
    };
  }

  // Pre-fetch all embeddings in parallel
  const [userEmbeddings, jobEmbeddings] = await Promise.all([
    Promise.all(userCodes.map(getSpecialtyEmbedding)),
    Promise.all(jobCodes.map(getSpecialtyEmbedding)),
  ]);

  let bestSimilarity = 0;
  let bestPair: { userCode: string; jobCode: string } | null = null;

  // Check all pairs and track the best match
  for (let i = 0; i < userEmbeddings.length; i++) {
    for (let j = 0; j < jobEmbeddings.length; j++) {
      const similarity = cosineSimilarity(userEmbeddings[i]!, jobEmbeddings[j]!);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestPair = { userCode: userCodes[i]!, jobCode: jobCodes[j]! };
      }
    }
  }

  return {
    hasMatch: bestSimilarity >= threshold,
    bestSimilarity,
    bestPair,
    userCodes,
  };
}
