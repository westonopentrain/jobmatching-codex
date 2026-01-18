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
  // Get all notifications
  const notifyResult = await pool.query(`
    SELECT 
      id, job_id, title, job_class, 
      countries_filter, languages_filter,
      total_candidates, total_above_threshold, notify_count,
      threshold_specialized, threshold_generic,
      created_at
    FROM audit_job_notify 
    ORDER BY created_at DESC 
    LIMIT 5
  `);
  
  console.log('=== ALL RECENT NOTIFICATIONS ===');
  for (const notify of notifyResult.rows) {
    console.log('\n--- ' + notify.title + ' (' + notify.job_class + ') ---');
    console.log('Candidates: ' + notify.total_candidates + ' | Above Threshold: ' + notify.total_above_threshold + ' | Notified: ' + notify.notify_count);
    console.log('Threshold specialized: ' + notify.threshold_specialized + ' | generic: ' + notify.threshold_generic);
    const langs = notify.languages_filter || [];
    console.log('Languages: ' + langs.join(', '));
    
    // Get results for this notification
    const resultsResult = await pool.query(`
      SELECT 
        user_id, user_country, user_languages, expertise_tier,
        domain_score, task_score, final_score, threshold_used,
        notified, filter_reason, rank
      FROM audit_job_notify_results
      WHERE notify_request_id = $1
      ORDER BY final_score DESC
    `, [notify.id]);
    
    console.log('\nUSERS:');
    for (const r of resultsResult.rows) {
      const status = r.notified ? 'NOTIFIED' : 'FILTERED (' + r.filter_reason + ')';
      console.log('  ' + (r.final_score * 100).toFixed(1) + '% (thresh: ' + (r.threshold_used * 100).toFixed(1) + '%) | ' + r.expertise_tier + ' | ' + r.user_country + ' | ' + status);
    }
  }
  
  await pool.end();
}

main().catch(console.error);
