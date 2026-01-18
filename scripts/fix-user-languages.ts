#!/usr/bin/env npx ts-node
/**
 * Fix language metadata for existing users in Pinecone.
 * Transforms "Slovak - Proficiency Level = Native" → "Slovak"
 */
import 'dotenv/config';
import { Pinecone } from '@pinecone-database/pinecone';
import { normalizeLanguages } from '../src/utils/sanitize';
import { requireEnv } from '../src/utils/env';

const BATCH_SIZE = 100;

async function main() {
  const apiKey = requireEnv('PINECONE_API_KEY');
  const indexName = requireEnv('PINECONE_INDEX');
  const host = requireEnv('PINECONE_HOST');

  const client = new Pinecone({ apiKey });
  const index = client.index(indexName, host);

  console.log('Querying users with malformed language metadata...\n');

  // Query all user domain vectors
  const response = await index.query({
    vector: new Array(1536).fill(0), // dummy vector
    topK: 10000,
    filter: { type: 'user', section: 'domain' },
    includeMetadata: true,
  });

  const usersToFix: Array<{ id: string; oldLangs: string[]; newLangs: string[] }> = [];

  for (const match of response.matches ?? []) {
    const meta = match.metadata as Record<string, unknown> | undefined;
    if (!meta) continue;

    const langs = meta.languages as string[] | undefined;
    if (!langs || langs.length === 0) continue;

    // Check if any language string contains " - " (needs fixing)
    const needsFix = langs.some(l => l.includes(' - ') || l.includes(','));
    if (needsFix) {
      const normalized = normalizeLanguages(langs);
      usersToFix.push({
        id: match.id,
        oldLangs: langs,
        newLangs: normalized,
      });
    }
  }

  console.log(`Found ${usersToFix.length} users needing language fix.\n`);

  if (usersToFix.length === 0) {
    console.log('No users need fixing. All good!');
    return;
  }

  // Show samples
  console.log('Sample fixes:');
  for (const user of usersToFix.slice(0, 5)) {
    console.log(`  ${user.id}`);
    console.log(`    Old: ${JSON.stringify(user.oldLangs)}`);
    console.log(`    New: ${JSON.stringify(user.newLangs)}`);
    console.log('');
  }

  // Ask for confirmation
  const args = process.argv.slice(2);
  if (!args.includes('--execute')) {
    console.log('\nDry run complete. Run with --execute to apply fixes.');
    return;
  }

  console.log('\nApplying fixes...\n');

  // Process in batches
  let fixed = 0;
  for (let i = 0; i < usersToFix.length; i += BATCH_SIZE) {
    const batch = usersToFix.slice(i, i + BATCH_SIZE);

    // For each user, we need to update both domain and task vectors
    for (const user of batch) {
      const userId = user.id.replace('usr_', '').replace('::domain', '');
      const domainId = `usr_${userId}::domain`;
      const taskId = `usr_${userId}::task`;

      // Fetch both vectors
      const vectors = await index.fetch([domainId, taskId]);

      const updates: Array<{ id: string; values: number[]; metadata: Record<string, unknown> }> = [];

      for (const [id, record] of Object.entries(vectors.records ?? {})) {
        if (record?.values && record.metadata) {
          const newMeta = { ...record.metadata, languages: user.newLangs };
          updates.push({ id, values: record.values, metadata: newMeta });
        }
      }

      if (updates.length > 0) {
        await index.upsert(updates);
        fixed++;
        if (fixed % 10 === 0) {
          console.log(`Fixed ${fixed}/${usersToFix.length} users...`);
        }
      }
    }
  }

  console.log(`\nDone! Fixed ${fixed} users.`);
}

main().catch(console.error);
