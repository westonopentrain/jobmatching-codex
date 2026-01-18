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
  // Get filtered out user IDs
  const filteredUserIds = [
    "1750149251286x934986574011452400",
    "1747992075703x902965103915698300",
    "1748131120731x845193847796079200",
    "1748279073091x152508575096187420",
    "1748246830193x163783982605030900",
    "1748178573278x462232149472945360"
  ];
  
  // Query user details from the users table
  const usersResult = await pool.query(`
    SELECT 
      bubble_id, country, languages, expertise_tier, expertise_capsule, domain_capsule, labeling_exp_capsule, created_at
    FROM users
    WHERE bubble_id = ANY($1)
  `, [filteredUserIds]);
  
  console.log('=== FILTERED USERS DETAILS ===');
  for (const r of usersResult.rows) {
    console.log(JSON.stringify(r, null, 2));
    console.log('---');
  }
  
  await pool.end();
}

main().catch(console.error);
