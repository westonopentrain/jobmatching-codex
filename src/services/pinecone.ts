import { Pinecone, Index, type RecordMetadata } from '@pinecone-database/pinecone';
import { getEnv, requireEnv } from '../utils/env';
import { withRetry } from '../utils/retry';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

export type VectorMetadata = RecordMetadata;

export interface FetchedVector {
  id: string;
  values: number[];
  metadata?: VectorMetadata;
}

export interface QueryMatch {
  id: string;
  score: number;
  metadata?: VectorMetadata;
}

let pineconeIndex: Index<VectorMetadata> | null = null;

function createClient(): { client: Pinecone; host: string | undefined } {
  const apiKey = requireEnv('PINECONE_API_KEY');
  const host = getEnv('PINECONE_HOST');
  const controllerHost = getEnv('PINECONE_ENV') ?? getEnv('PINECONE_CONTROLLER_HOST');
  if (!host && !controllerHost) {
    throw new Error('Environment variable PINECONE_HOST (preferred) or PINECONE_ENV must be set');
  }

  const client = controllerHost
    ? new Pinecone({ apiKey, controllerHostUrl: controllerHost })
    : new Pinecone({ apiKey });

  return { client, host };
}

function getIndex(): Index<VectorMetadata> {
  if (!pineconeIndex) {
    const indexName = requireEnv('PINECONE_INDEX');
    const { client, host } = createClient();

    if (!host) {
      logger.warn(
        { event: 'pinecone.host.fallback', indexName },
        'PINECONE_HOST not set; using controller host fallback. Update configuration to use the serverless host URL.'
      );
    }

    pineconeIndex = host
      ? client.index<VectorMetadata>(indexName, host)
      : client.index<VectorMetadata>(indexName);
  }
  return pineconeIndex;
}

export async function upsertVector(id: string, values: number[], metadata: VectorMetadata): Promise<void> {
  const index = getIndex();
  await withRetry(() => index.upsert([{ id, values, metadata }])).catch((error) => {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError({
      code: 'UPSERT_FAILURE',
      statusCode: 502,
      message: 'Failed to upsert vector to Pinecone',
      details: { message: (error as Error).message, id },
    });
  });
}

interface FetchOptions {
  namespace?: string;
}

// Batch size for fetch requests to avoid 414 URI Too Large errors
const FETCH_BATCH_SIZE = 100;

export async function fetchVectors(ids: string[], options?: FetchOptions): Promise<Record<string, FetchedVector>> {
  if (ids.length === 0) {
    return {};
  }

  const index = getIndex();
  const result: Record<string, FetchedVector> = {};

  // Split IDs into batches to avoid URL length limits
  for (let i = 0; i < ids.length; i += FETCH_BATCH_SIZE) {
    const batchIds = ids.slice(i, i + FETCH_BATCH_SIZE);
    const fetchArgs = options?.namespace ? { ids: batchIds, namespace: options.namespace } : batchIds;

    const response = await withRetry(() =>
      index.fetch(fetchArgs as Parameters<Index<VectorMetadata>['fetch']>[0])
    ).catch((error) => {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError({
        code: 'PINECONE_FETCH_FAILURE',
        statusCode: 502,
        message: 'Failed to fetch vectors from Pinecone',
        details: { message: (error as Error).message, ids: batchIds },
      });
    });

    const records = response.records ?? {};
    for (const [key, record] of Object.entries(records)) {
      if (record && Array.isArray(record.values)) {
        const entry: FetchedVector = { id: key, values: record.values };
        if (record.metadata !== undefined) {
          entry.metadata = record.metadata;
        }
        result[key] = entry;
      }
    }
  }

  return result;
}

interface QueryOptions {
  values: number[];
  topK: number;
  filter?: Record<string, unknown>;
  namespace?: string;
}

export async function deleteVectors(ids: string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }

  const index = getIndex();
  await withRetry(() => index.deleteMany(ids)).catch((error) => {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError({
      code: 'PINECONE_DELETE_FAILURE',
      statusCode: 502,
      message: 'Failed to delete vectors from Pinecone',
      details: { message: (error as Error).message, ids },
    });
  });
}

export async function queryByVector(options: QueryOptions): Promise<QueryMatch[]> {
  const index = getIndex();
  const queryRequest: Record<string, unknown> = {
    vector: options.values,
    topK: options.topK,
    includeMetadata: true,
  };

  if (options.filter !== undefined) {
    queryRequest.filter = options.filter;
  }

  if (options.namespace) {
    queryRequest.namespace = options.namespace;
  }

  const response = await withRetry(() =>
    index.query(queryRequest as Parameters<Index<VectorMetadata>['query']>[0])
  ).catch((error) => {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError({
      code: 'PINECONE_QUERY_FAILURE',
      statusCode: 502,
      message: 'Failed to query Pinecone',
      details: { message: (error as Error).message },
    });
  });

  return (response.matches ?? []).map((match) => {
    const mapped: QueryMatch = {
      id: match.id,
      score: match.score ?? 0,
    };

    if (match.metadata !== undefined) {
      mapped.metadata = match.metadata as VectorMetadata;
    }

    return mapped;
  });
}

/**
 * Query all users matching metadata filters (country, languages).
 * Used by /v1/jobs/notify to find ALL users in specific countries/languages.
 * Returns user IDs and their similarity scores to the job vector.
 */
export interface UserFilterOptions {
  jobVector: number[];
  countries?: string[];
  languages?: string[];
  topK?: number;
  namespace?: string;
}

export interface FilteredUserMatch {
  userId: string;
  score: number;
  metadata?: VectorMetadata;
}

export async function queryUsersByFilter(options: UserFilterOptions): Promise<FilteredUserMatch[]> {
  const { jobVector, countries, languages, topK = 10000, namespace } = options;
  const index = getIndex();

  // Build metadata filter
  // type='user', section='domain', plus country and language filters
  const filter: Record<string, unknown> = {
    type: 'user',
    section: 'domain',
  };

  // Country filter: match if user's country is in the list
  // Handle "Global" specially - if "Global" is in available_countries, include users with any country
  if (countries && countries.length > 0) {
    const hasGlobal = countries.some(c => c.toLowerCase() === 'global' || c === 'Global - Any Location');
    if (!hasGlobal) {
      // Only filter by country if not global
      filter.country = { $in: countries };
    }
    // If hasGlobal, don't add country filter - accept all countries
  }

  // Language filter: require ALL specified languages (AND logic)
  // When a job requires ["Slovak", "English"], user must speak BOTH languages
  if (languages && languages.length > 0) {
    if (languages.length === 1) {
      // Single language: simple containment check
      filter.languages = { $in: languages };
    } else {
      // Multiple languages: require ALL of them using $and
      // Each condition checks that the user's languages array contains this language
      filter.$and = languages.map(lang => ({
        languages: { $in: [lang] }
      }));
    }
  }

  const queryRequest: Record<string, unknown> = {
    vector: jobVector,
    topK,
    includeMetadata: true,
    filter,
  };

  if (namespace) {
    queryRequest.namespace = namespace;
  }

  const response = await withRetry(() =>
    index.query(queryRequest as Parameters<Index<VectorMetadata>['query']>[0])
  ).catch((error) => {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError({
      code: 'PINECONE_QUERY_FAILURE',
      statusCode: 502,
      message: 'Failed to query users by filter',
      details: { message: (error as Error).message },
    });
  });

  const results: FilteredUserMatch[] = [];
  for (const match of response.matches ?? []) {
    const metadata = match.metadata as Record<string, unknown> | undefined;
    const userId = metadata?.user_id as string | undefined;
    if (userId) {
      results.push({
        userId,
        score: match.score ?? 0,
        metadata: metadata as VectorMetadata,
      });
    }
  }

  return results;
}

/**
 * Query users who have overlapping subject matter codes with the required codes.
 * Uses Pinecone's $in operator to check if any user codes match required codes.
 *
 * @param userIds - List of user IDs to check (from previous query)
 * @param requiredCodes - Subject matter codes required by the job (e.g., ["technology:angular"])
 * @returns Set of user IDs who have at least one matching code
 */
export async function queryUsersWithSubjectMatterCodes(
  userIds: string[],
  requiredCodes: string[],
  namespace?: string
): Promise<Set<string>> {
  if (userIds.length === 0 || requiredCodes.length === 0) {
    return new Set();
  }

  const index = getIndex();
  const matchingUserIds = new Set<string>();

  // Query for users whose subject_matter_codes overlap with required codes
  // Pinecone's $in operator checks if the field contains any of the specified values
  const filter: Record<string, unknown> = {
    type: 'user',
    section: 'domain',
    user_id: { $in: userIds },
    subject_matter_codes: { $in: requiredCodes },
  };

  const queryRequest: Record<string, unknown> = {
    // Use a zero vector since we only care about metadata filtering
    vector: new Array(1536).fill(0),
    topK: userIds.length,
    includeMetadata: true,
    filter,
  };

  if (namespace) {
    queryRequest.namespace = namespace;
  }

  const response = await withRetry(() =>
    index.query(queryRequest as Parameters<Index<VectorMetadata>['query']>[0])
  ).catch((error) => {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError({
      code: 'PINECONE_QUERY_FAILURE',
      statusCode: 502,
      message: 'Failed to query users by subject matter codes',
      details: { message: (error as Error).message },
    });
  });

  for (const match of response.matches ?? []) {
    const metadata = match.metadata as Record<string, unknown> | undefined;
    const userId = metadata?.user_id as string | undefined;
    if (userId) {
      matchingUserIds.add(userId);
    }
  }

  return matchingUserIds;
}

/**
 * Update metadata for existing vectors without regenerating embeddings.
 * Used for metadata-only updates (e.g., country/language changes).
 * This is much cheaper than a full re-upsert since it skips LLM calls.
 *
 * @param ids - Vector IDs to update
 * @param metadata - New metadata to merge with existing metadata
 * @param namespace - Optional namespace
 */
export async function updateVectorMetadata(
  ids: string[],
  metadata: VectorMetadata,
  namespace?: string
): Promise<void> {
  if (ids.length === 0) {
    return;
  }

  const index = getIndex();

  // Update each vector's metadata
  // Pinecone's update method merges the provided metadata with existing metadata
  await Promise.all(
    ids.map((id) =>
      withRetry(() => {
        const updateRequest: { id: string; metadata: VectorMetadata; namespace?: string } = {
          id,
          metadata,
        };
        if (namespace) {
          updateRequest.namespace = namespace;
        }
        return index.update(updateRequest);
      }).catch((error) => {
        if (error instanceof AppError) {
          throw error;
        }
        throw new AppError({
          code: 'PINECONE_UPDATE_FAILURE',
          statusCode: 502,
          message: 'Failed to update vector metadata in Pinecone',
          details: { message: (error as Error).message, id },
        });
      })
    )
  );
}
