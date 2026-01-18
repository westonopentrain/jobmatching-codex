#!/usr/bin/env npx ts-node
/**
 * Check metadata for recently upserted users in Pinecone
 */
import 'dotenv/config';
import { fetchVectors } from '../src/services/pinecone';

const USER_IDS = [
  '1748252609363x121283036493989400', // Slovakia user from screenshot
  '1748344801414x554730',
  '1748243247438x878713',
];

async function main() {
  console.log('Checking user metadata in Pinecone...\n');

  for (const userId of USER_IDS) {
    const domainVectorId = `usr_${userId}::domain`;

    try {
      const vectors = await fetchVectors([domainVectorId]);
      const vector = vectors[domainVectorId];

      if (vector?.metadata) {
        console.log(`User: ${userId}`);
        console.log(`  Country: ${vector.metadata.country}`);
        console.log(`  Languages: ${JSON.stringify(vector.metadata.languages)}`);
        console.log(`  Type: ${vector.metadata.type}`);
        console.log(`  Section: ${vector.metadata.section}`);
        console.log('');
      } else {
        console.log(`User ${userId}: NOT FOUND in Pinecone\n`);
      }
    } catch (error) {
      console.error(`Error fetching ${userId}:`, error);
    }
  }
}

main().catch(console.error);
