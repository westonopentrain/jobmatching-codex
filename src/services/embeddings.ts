import { getOpenAIClient } from './openai-client';
import { withRetry } from '../utils/retry';
import { AppError } from '../utils/errors';

export const EMBEDDING_MODEL = 'text-embedding-3-large';
export const EMBEDDING_DIMENSION = 3072;

export async function embedText(text: string): Promise<number[]> {
  const client = getOpenAIClient();

  const response = await withRetry(() =>
    client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
    })
  ).catch((error) => {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError({
      code: 'EMBEDDING_FAILURE',
      statusCode: 502,
      message: 'Failed to generate embedding',
      details: { message: (error as Error).message },
    });
  });

  const embedding = response.data?.[0]?.embedding;
  if (!embedding || embedding.length !== EMBEDDING_DIMENSION) {
    throw new AppError({
      code: 'EMBEDDING_FAILURE',
      statusCode: 502,
      message: 'Embedding response missing expected vector',
      details: { received: embedding?.length ?? 0 },
    });
  }

  return embedding;
}
