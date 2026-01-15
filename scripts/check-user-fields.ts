/**
 * Check all available fields on user profiles for German Web Developer applicants
 */

const BUBBLE_API = 'https://app.opentrain.ai/version-02wlo/api/1.1/obj';
const API_KEY = 'ac589face4818ffaeec13163c764dbc7';

const GERMAN_JOB_ID = '1722932177934x195359492446617600';

async function fetchJobOffers(jobId: string): Promise<any[]> {
  const constraint = encodeURIComponent(JSON.stringify([{ key: 'Job', constraint_type: 'equals', value: jobId }]));
  const response = await fetch(`${BUBBLE_API}/jobOffer?constraints=${constraint}&limit=10`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  const data = await response.json() as any;
  return data.response.results;
}

async function fetchUser(userId: string): Promise<any> {
  const response = await fetch(`${BUBBLE_API}/User/${userId}`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  const data = await response.json() as any;
  return data.response;
}

async function main() {
  console.log('Fetching German Web Developer applicants...\n');

  const offers = await fetchJobOffers(GERMAN_JOB_ID);
  const hiredOffer = offers.find(o => o.Offer_Status === 'Hired');

  if (!hiredOffer) {
    console.log('No hired offer found');
    return;
  }

  const userId = hiredOffer.Labeler || hiredOffer['Created By'];
  const user = await fetchUser(userId);

  console.log('='.repeat(80));
  console.log('ALL FIELDS ON USER PROFILE');
  console.log('='.repeat(80));

  const allKeys = Object.keys(user).sort();
  console.log('\nField names (' + allKeys.length + ' total):');
  console.log(allKeys.join('\n'));

  console.log('\n\n' + '='.repeat(80));
  console.log('FIELDS WITH VALUES (non-empty)');
  console.log('='.repeat(80));

  for (const key of allKeys) {
    const value = user[key];
    if (value !== null && value !== undefined && value !== '' && value !== false) {
      const valueStr = typeof value === 'string'
        ? value.slice(0, 200)
        : JSON.stringify(value).slice(0, 200);
      console.log('\n' + key + ':');
      console.log('  ' + valueStr);
    }
  }

  // Look specifically for resume-related fields
  console.log('\n\n' + '='.repeat(80));
  console.log('SEARCHING FOR RESUME/TEXT FIELDS');
  console.log('='.repeat(80));

  const resumeFields = allKeys.filter(k =>
    k.toLowerCase().includes('resume') ||
    k.toLowerCase().includes('text') ||
    k.toLowerCase().includes('description') ||
    k.toLowerCase().includes('profile') ||
    k.toLowerCase().includes('bio')
  );

  console.log('\nPotential resume/text fields:');
  for (const field of resumeFields) {
    const value = user[field];
    console.log('\n' + field + ':');
    if (typeof value === 'string') {
      console.log('  [STRING] ' + value.slice(0, 500));
    } else {
      console.log('  [' + typeof value + '] ' + JSON.stringify(value).slice(0, 200));
    }
  }
}

main().catch(console.error);
