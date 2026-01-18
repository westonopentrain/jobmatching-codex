#!/usr/bin/env npx ts-node
import 'dotenv/config';
import { Pinecone } from '@pinecone-database/pinecone';
import { requireEnv } from '../src/utils/env';

async function main() {
  const client = new Pinecone({ apiKey: requireEnv('PINECONE_API_KEY') });
  const index = client.index(requireEnv('PINECONE_INDEX'), requireEnv('PINECONE_HOST'));

  const countries = ['Slovakia', 'Czech', 'Czech Republic'];

  for (const country of countries) {
    console.log(`\n=== Checking country: ${country} ===\n`);

    try {
      const response = await index.query({
        vector: new Array(3072).fill(0),
        topK: 50,
        filter: { type: 'user', section: 'domain', country: country },
        includeMetadata: true,
      });

      if (!response.matches || response.matches.length === 0) {
        console.log(`No users found for ${country}`);
        continue;
      }

      console.log(`Found ${response.matches.length} users:\n`);

      for (const match of response.matches) {
        const meta = match.metadata as Record<string, unknown>;
        console.log(`User: ${meta.user_id}`);
        console.log(`  Country: ${meta.country}`);
        console.log(`  Languages: ${JSON.stringify(meta.languages)}`);
        console.log(`  Expertise: ${meta.expertise_tier}`);
        console.log('');
      }
    } catch (err) {
      console.error(`Error querying ${country}:`, err);
    }
  }
}

main().catch(console.error);
