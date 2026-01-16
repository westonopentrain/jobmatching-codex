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

export async function fetchVectors(ids: string[], options?: FetchOptions): Promise<Record<string, FetchedVector>> {
  if (ids.length === 0) {
    return {};
  }

  const index = getIndex();
  const fetchArgs = options?.namespace ? { ids, namespace: options.namespace } : ids;

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
      details: { message: (error as Error).message, ids },
    });
  });

  const records = response.records ?? {};
  const result: Record<string, FetchedVector> = {};
  for (const [key, record] of Object.entries(records)) {
    if (record && Array.isArray(record.values)) {
      const entry: FetchedVector = { id: key, values: record.values };
      if (record.metadata !== undefined) {
        entry.metadata = record.metadata;
      }
      result[key] = entry;
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
