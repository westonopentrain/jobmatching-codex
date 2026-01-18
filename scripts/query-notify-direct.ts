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

async function main() {
  // Get the most recent notification
  const notifyResult = await pool.query(`
    SELECT 
      id, job_id, title, job_class, 
      countries_filter, languages_filter,
      max_notifications, total_candidates, total_above_threshold, notify_count,
      threshold_specialized, threshold_generic,
      score_min, score_max, elapsed_ms, created_at
    FROM audit_job_notify 
    ORDER BY created_at DESC 
    LIMIT 1
  `);
  
  if (notifyResult.rows.length === 0) {
    console.log('No notification records found');
    return;
  }
  
  const notify = notifyResult.rows[0];
  console.log('=== NOTIFICATION SUMMARY ===');
  console.log(JSON.stringify(notify, null, 2));
  
  // Get all results for this notification
  const resultsResult = await pool.query(`
    SELECT 
      user_id, user_country, user_languages, expertise_tier,
      domain_score, task_score, final_score, threshold_used,
      notified, filter_reason, rank
    FROM audit_job_notify_results
    WHERE notify_request_id = $1
    ORDER BY final_score DESC
  `, [notify.id]);
  
  console.log('\n=== ALL USER RESULTS ===');
  for (const r of resultsResult.rows) {
    console.log(JSON.stringify(r));
  }
  
  await pool.end();
}

main().catch(console.error);
