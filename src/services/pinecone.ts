import { Pinecone, Index, type RecordMetadata } from '@pinecone-database/pinecone';
import { getEnv, requireEnv } from '../utils/env';
import { withRetry } from '../utils/retry';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

export type VectorMetadata = RecordMetadata;

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
