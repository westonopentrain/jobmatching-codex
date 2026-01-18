#!/usr/bin/env npx ts-node
import 'dotenv/config';
import { Pinecone } from '@pinecone-database/pinecone';
import { requireEnv } from '../src/utils/env';

async function main() {
  const client = new Pinecone({ apiKey: requireEnv('PINECONE_API_KEY') });
  const index = client.index(requireEnv('PINECONE_INDEX'), requireEnv('PINECONE_HOST'));

  // Query recent user domain vectors (index dimension is 3072)
  const response = await index.query({
    vector: new Array(3072).fill(0),
    topK: 100,
    filter: { type: 'user', section: 'domain' },
    includeMetadata: true,
  });

  console.log('Users in Pinecone:\n');
  console.log('Country'.padEnd(15) + '| Languages'.padEnd(40) + '| Expertise'.padEnd(15) + '| User ID');
  console.log('-'.repeat(100));

  const users = response.matches ?? [];

  // Sort by country for readability
  users.sort((a, b) => {
    const countryA = (a.metadata as Record<string, unknown>)?.country as string || '';
    const countryB = (b.metadata as Record<string, unknown>)?.country as string || '';
    return countryA.localeCompare(countryB);
  });

  let malformedCount = 0;

  for (const match of users) {
    const meta = match.metadata as Record<string, unknown>;
    const userId = meta.user_id as string || 'N/A';
    const country = (meta.country as string || 'N/A').padEnd(14);
    const languages = meta.languages as string[] || [];
    const tier = (meta.expertise_tier as string || 'N/A').padEnd(14);

    // Check if languages are malformed (contain " - " or are comma-separated in single string)
    const isMalformed = languages.some(l => l.includes(' - ') || (l.includes(',') && languages.length === 1));
    if (isMalformed) malformedCount++;

    const langStr = JSON.stringify(languages).slice(0, 38).padEnd(39);
    const marker = isMalformed ? ' ⚠️' : '';

    console.log(`${country} | ${langStr} | ${tier} | ${userId.slice(0, 25)}...${marker}`);
  }

  console.log('-'.repeat(100));
  console.log(`Total users: ${users.length}`);
  console.log(`Malformed languages: ${malformedCount}`);

  if (malformedCount > 0) {
    console.log('\n⚠️  Some users have malformed language metadata and need to be re-upserted.');
  } else {
    console.log('\n✅ All language metadata looks correct!');
  }
}

main().catch(console.error);
