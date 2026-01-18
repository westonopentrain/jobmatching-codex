import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // Get the most recent notification
  const notify = await prisma.auditJobNotify.findFirst({
    orderBy: { createdAt: 'desc' },
    include: {
      results: {
        orderBy: { finalScore: 'desc' }
      }
    }
  });
  
  if (!notify) {
    console.log('No notification records found');
    return;
  }
  
  console.log('=== NOTIFICATION SUMMARY ===');
  console.log(JSON.stringify({
    id: notify.id,
    jobId: notify.jobId,
    title: notify.title,
    jobClass: notify.jobClass,
    countriesFilter: notify.countriesFilter,
    languagesFilter: notify.languagesFilter,
    maxNotifications: notify.maxNotifications,
    totalCandidates: notify.totalCandidates,
    totalAboveThreshold: notify.totalAboveThreshold,
    notifyCount: notify.notifyCount,
    thresholdSpecialized: notify.thresholdSpecialized,
    thresholdGeneric: notify.thresholdGeneric,
    scoreMin: notify.scoreMin,
    scoreMax: notify.scoreMax,
    elapsedMs: notify.elapsedMs,
    createdAt: notify.createdAt
  }, null, 2));
  
  console.log('\n=== ALL USER RESULTS ===');
  for (const r of notify.results) {
    console.log(JSON.stringify({
      userId: r.userId,
      country: r.userCountry,
      languages: r.userLanguages,
      tier: r.expertiseTier,
      domainScore: r.domainScore,
      taskScore: r.taskScore,
      finalScore: r.finalScore,
      thresholdUsed: r.thresholdUsed,
      notified: r.notified,
      filterReason: r.filterReason,
      rank: r.rank
    }));
  }
  
  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);
