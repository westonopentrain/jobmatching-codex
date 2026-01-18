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
  // Get the OBGYN notification
  const notifyResult = await pool.query(`
    SELECT id FROM audit_job_notify 
    WHERE title LIKE '%OBGYN%' 
    ORDER BY created_at DESC 
    LIMIT 1
  `);
  
  if (notifyResult.rows.length === 0) {
    console.log('No OBGYN notification found');
    return;
  }
  
  const notifyId = notifyResult.rows[0].id;
  
  // Get filtered users with scores between 35-50%
  const resultsResult = await pool.query(`
    SELECT 
      user_id, user_country, user_languages, expertise_tier,
      domain_score, task_score, final_score, threshold_used,
      notified, filter_reason
    FROM audit_job_notify_results
    WHERE notify_request_id = $1
      AND notified = false
      AND final_score > 0.35
    ORDER BY final_score DESC
    LIMIT 20
  `, [notifyId]);
  
  console.log('=== FILTERED OBGYN USERS (35-50% scores) ===');
  console.log('These are the users who MIGHT have OBGYN experience but were filtered:\n');
  
  for (const r of resultsResult.rows) {
    console.log('User: ' + r.user_id);
    console.log('  Score: ' + (r.final_score * 100).toFixed(1) + '% (domain: ' + (r.domain_score * 100).toFixed(1) + '%, task: ' + (r.task_score * 100).toFixed(1) + '%)');
    console.log('  Tier: ' + r.expertise_tier + ' | Country: ' + r.user_country);
    console.log('  Threshold: ' + (r.threshold_used * 100).toFixed(1) + '%');
    console.log('');
  }
  
  await pool.end();
}

main().catch(console.error);
