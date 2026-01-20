/**
 * Find users that are in Bubble but not in the audit database
 *
 * This script:
 * 1. Queries Bubble for all users with `signUp_lblronbrd_done = yes`
 * 2. Queries audit_user_upserts for all user IDs
 * 3. Outputs list of Bubble users NOT in audit (missing/failed)
 *
 * Usage: npx tsx scripts/find-missing-users.ts
 *
 * Set DATABASE_URL environment variable to connect to the database.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Bubble API configuration
const BUBBLE_API = 'https://app.opentrain.ai/version-02wlo/api/1.1/obj';
const API_KEY = 'ac589face4818ffaeec13163c764dbc7';

interface BubbleUser {
  _id: string;
  userfirstName?: string;
  userlastName?: string;
  signUp_lblronbrd_done?: string;
  lblrType_Agency_Freelancer?: string;
  [key: string]: unknown;
}

interface BubbleResponse {
  response: {
    cursor: number;
    results: BubbleUser[];
    count: number;
    remaining: number;
  };
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL not set');
  console.error('Usage: DATABASE_URL=... npx tsx scripts/find-missing-users.ts');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/**
 * Fetch all freelancers from Bubble who have completed onboarding
 */
async function fetchBubbleUsers(): Promise<BubbleUser[]> {
  const allUsers: BubbleUser[] = [];
  let cursor = 0;
  const limit = 100;

  console.log('Fetching users from Bubble...');

  // Build constraints for the API call
  // Only get freelancers who have completed signup
  const constraints = [
    { key: 'signUp_lblronbrd_done', constraint_type: 'equals', value: 'yes' },
    { key: 'lblrType_Agency/Freelancer', constraint_type: 'equals', value: 'Freelancer' },
  ];

  const constraintsParam = encodeURIComponent(JSON.stringify(constraints));

  while (true) {
    const url = `${BUBBLE_API}/User?cursor=${cursor}&limit=${limit}&constraints=${constraintsParam}`;

    try {
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${API_KEY}` }
      });

      if (!response.ok) {
        throw new Error(`Bubble API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as BubbleResponse;
      const results = data.response.results;

      allUsers.push(...results);

      console.log(`  Fetched ${allUsers.length} users so far...`);

      if (data.response.remaining === 0) {
        break;
      }

      cursor += limit;
    } catch (error) {
      console.error('Error fetching from Bubble:', error);
      throw error;
    }
  }

  return allUsers;
}

/**
 * Get all user IDs that have been successfully upserted
 */
async function getUpstartedUserIds(): Promise<Set<string>> {
  console.log('Fetching upserted user IDs from database...');

  const upserts = await prisma.auditUserUpsert.findMany({
    distinct: ['userId'],
    select: { userId: true }
  });

  const userIds = new Set(upserts.map(u => u.userId));
  console.log(`  Found ${userIds.size} unique user IDs in audit_user_upserts`);

  return userIds;
}

/**
 * Get all user IDs that have failed upserts
 */
async function getFailedUserIds(): Promise<Map<string, { errorCode: string; errorMessage: string; createdAt: Date }>> {
  console.log('Fetching failed user IDs from database...');

  const failures = await prisma.auditUpsertFailure.findMany({
    where: { entityType: 'user' },
    orderBy: { createdAt: 'desc' },
  });

  // Group by entityId, keeping only the most recent failure
  const failedUsers = new Map<string, { errorCode: string; errorMessage: string; createdAt: Date }>();
  for (const failure of failures) {
    if (!failedUsers.has(failure.entityId)) {
      failedUsers.set(failure.entityId, {
        errorCode: failure.errorCode,
        errorMessage: failure.errorMessage,
        createdAt: failure.createdAt,
      });
    }
  }

  console.log(`  Found ${failedUsers.size} unique user IDs in audit_upsert_failures`);

  return failedUsers;
}

async function main() {
  try {
    // Fetch all data
    const [bubbleUsers, upsertedIds, failedUsers] = await Promise.all([
      fetchBubbleUsers(),
      getUpstartedUserIds(),
      getFailedUserIds(),
    ]);

    console.log('\n=== SUMMARY ===');
    console.log(`Total Bubble freelancers (onboarded): ${bubbleUsers.length}`);
    console.log(`Successfully upserted: ${upsertedIds.size}`);
    console.log(`Failed upserts: ${failedUsers.size}`);

    // Find missing users (in Bubble but not in audit)
    const missingUsers: BubbleUser[] = [];
    const failedButNotRetried: Array<{ user: BubbleUser; error: { errorCode: string; errorMessage: string; createdAt: Date } }> = [];

    for (const user of bubbleUsers) {
      if (!upsertedIds.has(user._id)) {
        if (failedUsers.has(user._id)) {
          failedButNotRetried.push({
            user,
            error: failedUsers.get(user._id)!,
          });
        } else {
          missingUsers.push(user);
        }
      }
    }

    console.log(`\nMissing (never attempted): ${missingUsers.length}`);
    console.log(`Failed (need retry): ${failedButNotRetried.length}`);

    // Output missing users
    if (missingUsers.length > 0) {
      console.log('\n=== MISSING USERS (never attempted) ===');
      console.log('These users exist in Bubble but have never been sent to the Render service:');
      for (const user of missingUsers.slice(0, 50)) {
        console.log(`  ${user._id} - ${user.userfirstName || ''} ${user.userlastName || ''}`);
      }
      if (missingUsers.length > 50) {
        console.log(`  ... and ${missingUsers.length - 50} more`);
      }
    }

    // Output failed users
    if (failedButNotRetried.length > 0) {
      console.log('\n=== FAILED USERS (need retry) ===');
      console.log('These users failed to upsert and should be retried:');

      // Group by error code
      const byErrorCode = new Map<string, Array<{ user: BubbleUser; error: { errorCode: string; errorMessage: string; createdAt: Date } }>>();
      for (const item of failedButNotRetried) {
        const code = item.error.errorCode;
        if (!byErrorCode.has(code)) {
          byErrorCode.set(code, []);
        }
        byErrorCode.get(code)!.push(item);
      }

      for (const [errorCode, items] of byErrorCode) {
        console.log(`\n  Error: ${errorCode} (${items.length} users)`);
        console.log(`  Sample message: ${items[0]?.error.errorMessage.slice(0, 100)}`);
        for (const item of items.slice(0, 10)) {
          console.log(`    ${item.user._id}`);
        }
        if (items.length > 10) {
          console.log(`    ... and ${items.length - 10} more`);
        }
      }
    }

    // Output JSON for easy processing
    if (missingUsers.length > 0 || failedButNotRetried.length > 0) {
      console.log('\n=== JSON OUTPUT ===');
      console.log(JSON.stringify({
        summary: {
          totalBubbleUsers: bubbleUsers.length,
          successfullyUpserted: upsertedIds.size,
          missingCount: missingUsers.length,
          failedCount: failedButNotRetried.length,
        },
        missingUserIds: missingUsers.map(u => u._id),
        failedUserIds: failedButNotRetried.map(item => ({
          userId: item.user._id,
          errorCode: item.error.errorCode,
          errorMessage: item.error.errorMessage.slice(0, 200),
        })),
      }, null, 2));
    } else {
      console.log('\nAll Bubble users have been successfully upserted!');
    }

  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch(console.error);
