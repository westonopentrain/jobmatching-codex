import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }
});

const JOB_ID = '1751971673741x217179543502848000';

async function main() {
  console.log('='.repeat(80));
  console.log('ANGULAR CODE REVIEWER JOB FILTERING ANALYSIS');
  console.log('='.repeat(80));
  console.log(`\nJob ID: ${JOB_ID}\n`);

  // Query 1: Get notification summary
  console.log('\n--- QUERY 1: NOTIFICATION SUMMARY ---\n');
  const notifyResult = await pool.query(`
    SELECT
      id, job_id, title, job_class,
      countries_filter, languages_filter, max_notifications,
      total_candidates, total_above_threshold, notify_count,
      threshold_specialized, threshold_generic,
      score_min, score_max, elapsed_ms, created_at
    FROM audit_job_notify
    WHERE job_id = $1
    ORDER BY created_at DESC
    LIMIT 1
  `, [JOB_ID]);

  if (notifyResult.rows.length === 0) {
    console.log('No notification record found for this job');
    await pool.end();
    return;
  }

  const notify = notifyResult.rows[0];
  console.log('Notification Record:');
  console.log(JSON.stringify(notify, null, 2));

  const notifyId = notify.id;

  // Query 2: Filter reason breakdown
  console.log('\n--- QUERY 2: FILTER REASON BREAKDOWN ---\n');
  const filterBreakdownResult = await pool.query(`
    SELECT filter_reason, COUNT(*) as count
    FROM audit_job_notify_results
    WHERE notify_request_id = $1
    GROUP BY filter_reason
    ORDER BY count DESC
  `, [notifyId]);

  console.log('Filter Reason Counts:');
  for (const row of filterBreakdownResult.rows) {
    console.log(`  ${row.filter_reason ?? 'NOTIFIED (null)'}: ${row.count}`);
  }

  // Query 3: Analyze users filtered for low_similarity
  console.log('\n--- QUERY 3: LOW_SIMILARITY FILTERED USERS ---\n');
  const lowSimilarityResult = await pool.query(`
    SELECT
      user_id, user_country, user_languages, expertise_tier,
      final_score, threshold_used, filter_reason
    FROM audit_job_notify_results
    WHERE notify_request_id = $1
      AND filter_reason LIKE 'low_similarity%'
    ORDER BY final_score DESC
    LIMIT 20
  `, [notifyId]);

  console.log(`Found ${lowSimilarityResult.rows.length} users filtered by low_similarity:\n`);

  // Get user subject matter codes from audit_user_upserts
  const lowSimUserIds = lowSimilarityResult.rows.map(r => r.user_id);

  const userCodesResult = await pool.query(`
    SELECT DISTINCT ON (user_id)
      user_id, subject_matter_codes, expertise_tier, country
    FROM audit_user_upserts
    WHERE user_id = ANY($1)
    ORDER BY user_id, created_at DESC
  `, [lowSimUserIds]);

  const userCodesMap = new Map<string, string[]>();
  for (const row of userCodesResult.rows) {
    userCodesMap.set(row.user_id, row.subject_matter_codes || []);
  }

  // Acceptable codes for this job
  const acceptableCodes = ['technology:typescript', 'technology:javascript', 'technology:rxjs', 'technology:frontend', 'technology:devops'];
  const requiredCodes = ['technology:angular'];

  for (const user of lowSimilarityResult.rows) {
    const codes = userCodesMap.get(user.user_id) || [];
    const hasAcceptable = codes.some(c =>
      acceptableCodes.some(ac => ac.toLowerCase() === c.toLowerCase()) ||
      requiredCodes.some(rc => rc.toLowerCase() === c.toLowerCase())
    );

    console.log(`User: ${user.user_id.slice(0, 20)}...`);
    console.log(`  Score: ${(user.final_score * 100).toFixed(1)}%`);
    console.log(`  Filter: ${user.filter_reason}`);
    console.log(`  Codes: ${codes.length > 0 ? codes.join(', ') : '(none)'}`);
    console.log(`  Has Acceptable/Required Code: ${hasAcceptable ? 'YES - BUG!' : 'NO (correct)'}`);
    console.log('');
  }

  // Query 4: Spot-check notified users (top 10)
  console.log('\n--- QUERY 4: TOP NOTIFIED USERS ---\n');
  const notifiedResult = await pool.query(`
    SELECT
      user_id, user_country, expertise_tier,
      final_score, rank
    FROM audit_job_notify_results
    WHERE notify_request_id = $1
      AND notified = true
    ORDER BY rank ASC
    LIMIT 10
  `, [notifyId]);

  const notifiedUserIds = notifiedResult.rows.map(r => r.user_id);

  const notifiedCodesResult = await pool.query(`
    SELECT DISTINCT ON (user_id)
      user_id, subject_matter_codes
    FROM audit_user_upserts
    WHERE user_id = ANY($1)
    ORDER BY user_id, created_at DESC
  `, [notifiedUserIds]);

  const notifiedCodesMap = new Map<string, string[]>();
  for (const row of notifiedCodesResult.rows) {
    notifiedCodesMap.set(row.user_id, row.subject_matter_codes || []);
  }

  console.log('Top 10 Notified Users (verify they have Angular/JS/TS expertise):\n');
  for (const user of notifiedResult.rows) {
    const codes = notifiedCodesMap.get(user.user_id) || [];
    const hasAngular = codes.some(c => c.toLowerCase().includes('angular'));
    const hasJS = codes.some(c => c.toLowerCase().includes('javascript'));
    const hasTS = codes.some(c => c.toLowerCase().includes('typescript'));
    const hasFrontend = codes.some(c => c.toLowerCase().includes('frontend'));

    console.log(`#${user.rank} (${(user.final_score * 100).toFixed(1)}%): ${user.user_id.slice(0, 20)}...`);
    console.log(`   Country: ${user.user_country}, Tier: ${user.expertise_tier}`);
    console.log(`   Codes: ${codes.join(', ') || '(none)'}`);
    console.log(`   Has Angular: ${hasAngular}, JS: ${hasJS}, TS: ${hasTS}, Frontend: ${hasFrontend}`);
    console.log('');
  }

  // Query 5: Check edge cases around 70% threshold
  console.log('\n--- QUERY 5: EDGE CASES AT 70% THRESHOLD ---\n');
  console.log('Looking for filter reasons with "70% < 70%" or similar edge cases...\n');

  const edgeCaseResult = await pool.query(`
    SELECT
      user_id, final_score, filter_reason
    FROM audit_job_notify_results
    WHERE notify_request_id = $1
      AND filter_reason LIKE '%70%'
    ORDER BY final_score DESC
  `, [notifyId]);

  if (edgeCaseResult.rows.length === 0) {
    console.log('No edge cases found with 70% in filter reason.');
  } else {
    console.log(`Found ${edgeCaseResult.rows.length} users with 70% in filter reason:\n`);
    for (const user of edgeCaseResult.rows) {
      console.log(`User: ${user.user_id.slice(0, 20)}...`);
      console.log(`  Score: ${(user.final_score * 100).toFixed(1)}%`);
      console.log(`  Filter: ${user.filter_reason}`);

      // Check if this looks like a rounding issue
      if (user.filter_reason && user.filter_reason.includes('70% < 70%')) {
        console.log('  ⚠️  POTENTIAL ROUNDING ISSUE: Shows "70% < 70%" which appears contradictory');
        console.log('     This is likely a display bug where actual similarity is 69.5-69.99%');
        console.log('     Math.round(0.695 * 100) = 70, but 0.695 < 0.70');
      }
      console.log('');
    }
  }

  // Query 6: Users filtered for no_subject_matter_codes
  console.log('\n--- QUERY 6: USERS WITH NO SUBJECT MATTER CODES ---\n');
  const noCodesResult = await pool.query(`
    SELECT COUNT(*) as count
    FROM audit_job_notify_results
    WHERE notify_request_id = $1
      AND filter_reason = 'no_subject_matter_codes'
  `, [notifyId]);

  console.log(`Users filtered for having no subject matter codes: ${noCodesResult.rows[0].count}`);

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`
Total candidates: ${notify.total_candidates}
Above base threshold (${(notify.threshold_specialized * 100).toFixed(0)}%): ${notify.total_above_threshold}
Notified: ${notify.notify_count}
Filtered out: ${notify.total_candidates - notify.notify_count}
  - By base threshold: ${notify.total_candidates - notify.total_above_threshold}
  - By subject matter: ${notify.total_above_threshold - notify.notify_count}
`);

  await pool.end();
}

main().catch(async (err) => {
  console.error('Error:', err);
  await pool.end();
  process.exit(1);
});
