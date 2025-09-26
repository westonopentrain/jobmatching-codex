import { Pinecone } from '@pinecone-database/pinecone';
import type { ServerlessSpecCloudEnum } from '@pinecone-database/pinecone';
import { getEnv, requireEnv } from '../src/utils/env';
import { EMBEDDING_DIMENSION } from '../src/services/embeddings';

const INDEX_METRIC = 'cosine';
type ServerlessCloud = ServerlessSpecCloudEnum;
const ALLOWED_CLOUDS: ServerlessCloud[] = ['aws', 'gcp', 'azure'];
const DEFAULT_CLOUD: ServerlessCloud = 'aws';
const DEFAULT_REGION = 'us-east-1';
const POLL_INTERVAL_MS = 5000;
const MAX_POLLS = 24; // Wait up to 2 minutes.

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureIndex(pinecone: Pinecone, indexName: string) {
  const indexes = await pinecone.listIndexes();
  const existing = indexes.indexes?.find((index) => index.name === indexName);
  if (existing) {
    console.log(`Index "${indexName}" already exists (dimension: ${existing.dimension}, metric: ${existing.metric}).`);
    return existing.host ?? null;
  }

  const cloudInput = getEnv('PINECONE_CLOUD');
  const cloud = (cloudInput ?? DEFAULT_CLOUD) as ServerlessCloud;
  if (cloudInput && !ALLOWED_CLOUDS.includes(cloud)) {
    throw new Error(`Invalid PINECONE_CLOUD value: ${cloudInput}. Valid options: ${ALLOWED_CLOUDS.join(', ')}`);
  }
  const region = getEnv('PINECONE_REGION') ?? DEFAULT_REGION;
  console.log(`Creating index "${indexName}" (${EMBEDDING_DIMENSION} dim, ${INDEX_METRIC}) in ${cloud}/${region}...`);

  await pinecone.createIndex({
    name: indexName,
    dimension: EMBEDDING_DIMENSION,
    metric: INDEX_METRIC,
    spec: {
      serverless: {
        cloud,
        region,
      },
    },
  });

  for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
    await sleep(POLL_INTERVAL_MS);
    const description = await pinecone.describeIndex(indexName);
    if (description.status?.ready) {
      console.log(`Index is ready after ${attempt + 1} checks.`);
      return description.host ?? null;
    }
    console.log(`Waiting for index to be ready (state: ${description.status?.state ?? 'unknown'})...`);
  }

  throw new Error('Timed out waiting for Pinecone index to become ready.');
}

async function main() {
  try {
    const apiKey = requireEnv('PINECONE_API_KEY');
    const indexName = requireEnv('PINECONE_INDEX');

    const pinecone = new Pinecone({ apiKey });
    const host = await ensureIndex(pinecone, indexName);
    const description = await pinecone.describeIndex(indexName);

    console.log('---');
    console.log(`Index name: ${description.name}`);
    console.log(`Dimension: ${description.dimension}`);
    console.log(`Metric: ${description.metric}`);
    console.log(`Host: ${description.host}`);
    if (!host && description.host) {
      console.log('Copy the host value into PINECONE_HOST in your environment configuration.');
    } else if (host) {
      console.log('Copy the host value above into PINECONE_HOST in your environment configuration.');
    }
  } catch (error) {
    console.error('Failed to create or describe Pinecone index.');
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}

main();
