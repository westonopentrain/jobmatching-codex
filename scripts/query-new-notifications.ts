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
  // Get all recent notifications
  const notifyResult = await pool.query(`
    SELECT 
      id, job_id, title, job_class, 
      countries_filter, languages_filter,
      total_candidates, total_above_threshold, notify_count,
      threshold_specialized, threshold_generic,
      created_at
    FROM audit_job_notify 
    ORDER BY created_at DESC 
    LIMIT 10
  `);
  
  console.log('=== ALL RECENT NOTIFICATIONS ===\n');
  for (const notify of notifyResult.rows) {
    console.log('='.repeat(80));
    console.log('JOB: ' + notify.title);
    console.log('Class: ' + notify.job_class + ' | Created: ' + notify.created_at);
    console.log('Candidates: ' + notify.total_candidates + ' | Above Threshold: ' + notify.total_above_threshold + ' | Notified: ' + notify.notify_count);
    const langs = notify.languages_filter || [];
    const countries = notify.countries_filter || [];
    console.log('Languages: ' + langs.join(', '));
    console.log('Countries: ' + countries.join(', '));
    console.log('Threshold: specialized=' + notify.threshold_specialized + ' generic=' + notify.threshold_generic);
    
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
    
    console.log('\n--- Notified Users ---');
    let notifiedCount = 0;
    for (const r of resultsResult.rows) {
      if (r.notified) {
        notifiedCount++;
        console.log('  #' + r.rank + ' | ' + (r.final_score * 100).toFixed(1) + '% (d:' + (r.domain_score * 100).toFixed(1) + '% t:' + (r.task_score * 100).toFixed(1) + '%) | ' + r.expertise_tier + ' | ' + r.user_country);
      }
    }
    if (notifiedCount === 0) console.log('  (none)');
    
    console.log('\n--- Filtered Users ---');
    let filteredCount = 0;
    for (const r of resultsResult.rows) {
      if (!r.notified) {
        filteredCount++;
        console.log('  ' + (r.final_score * 100).toFixed(1) + '% (thresh:' + (r.threshold_used * 100).toFixed(1) + '%) | ' + r.expertise_tier + ' | ' + r.user_country + ' | ' + r.filter_reason);
      }
    }
    if (filteredCount === 0) console.log('  (none)');
    console.log('\n');
  }
  
  await pool.end();
}

main().catch(console.error);
