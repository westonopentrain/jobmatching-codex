/**
 * Test matching for OBGYN job - analyze applicant qualifications
 */

const BUBBLE_API = 'https://app.opentrain.ai/version-02wlo/api/1.1/obj';
const API_KEY = 'ac589face4818ffaeec13163c764dbc7';

const OBGYN_JOB_ID = '1733994253353x683525100278382600';

interface BubbleJobOffer {
  _id: string;
  'Created Date': string;
  Job?: string;
  Labeler?: string;
  'Created By'?: string;
  Offer_Status?: string;
  offerType?: string;
  'AI Interview Score'?: number;
  Lblr_FirstName?: string;
  Lblr_LastName?: string;
  Lblr_Email?: string;
  [key: string]: unknown;
}

interface BubbleUser {
  _id: string;
  userfirstName?: string;
  userlastName?: string;
  lblr_ProfileTitle?: string;
  lblr_ProfileDescription?: string;
  lblr_Education?: string;
  lblr_LabelExperience?: string;
  lblr_freelancer3SubjectMatter?: string[];
  lblr_freelancer5LabelTypes?: string[];
  lblr_ExpertiseLevel?: string;
  lblr_Software?: string[];
  [key: string]: unknown;
}

async function fetchJobOffersForJob(jobId: string): Promise<BubbleJobOffer[]> {
  const constraint = encodeURIComponent(JSON.stringify([{ key: 'Job', constraint_type: 'equals', value: jobId }]));
  const url = `${BUBBLE_API}/jobOffer?constraints=${constraint}&limit=200`;

  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  const data = await response.json() as { response: { results: BubbleJobOffer[] } };

  return data.response.results;
}

async function fetchUser(userId: string): Promise<BubbleUser | null> {
  try {
    const response = await fetch(`${BUBBLE_API}/User/${userId}`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` }
    });
    const data = await response.json() as { response: BubbleUser };
    return data.response;
  } catch {
    return null;
  }
}

// Check if user has medical qualifications
function hasMedicalQualifications(user: BubbleUser): { qualified: boolean; signals: string[] } {
  const signals: string[] = [];

  const text = [
    user.lblr_ProfileTitle,
    user.lblr_ProfileDescription,
    user.lblr_Education,
    user.lblr_LabelExperience,
    ...(user.lblr_freelancer3SubjectMatter || []),
  ].filter(Boolean).join(' ').toLowerCase();

  // Check for medical credentials
  if (/\b(md|m\.d\.|doctor|physician|mbbs|m\.b\.b\.s)\b/i.test(text)) {
    signals.push('MD/Physician credential');
  }
  if (/\b(obgyn|ob-gyn|obstetrics|gynecology|obstetrician|gynecologist)\b/i.test(text)) {
    signals.push('OBGYN specialty');
  }
  if (/\b(residency|resident|fellowship)\b/i.test(text)) {
    signals.push('Medical residency');
  }
  if (/\b(clinical|hospital|patient|medical)\b/i.test(text)) {
    signals.push('Clinical experience');
  }
  if (/\b(nurse|rn|nursing|np)\b/i.test(text)) {
    signals.push('Nursing background');
  }
  if (/\b(health|healthcare|medicine)\b/i.test(text)) {
    signals.push('Healthcare domain');
  }

  const qualified = signals.some(s =>
    s.includes('MD') || s.includes('OBGYN') || s.includes('residency')
  );

  return { qualified, signals };
}

async function main() {
  console.log('=' .repeat(80));
  console.log('OBGYN JOB APPLICANT ANALYSIS');
  console.log('=' .repeat(80));
  console.log('\nFetching all proposals for OBGYN job...\n');

  const offers = await fetchJobOffersForJob(OBGYN_JOB_ID);
  console.log(`Total proposals: ${offers.length}\n`);

  // Categorize applicants
  const qualified: { offer: BubbleJobOffer; user: BubbleUser; signals: string[] }[] = [];
  const unqualified: { offer: BubbleJobOffer; user: BubbleUser | null; signals: string[] }[] = [];

  for (const offer of offers) {
    const userId = offer.Labeler || offer['Created By'];
    if (!userId) continue;

    const user = await fetchUser(userId);
    if (!user) {
      unqualified.push({ offer, user: null, signals: ['User not found'] });
      continue;
    }

    const { qualified: isQualified, signals } = hasMedicalQualifications(user);

    if (isQualified) {
      qualified.push({ offer, user, signals });
    } else {
      unqualified.push({ offer, user, signals });
    }
  }

  // Show qualified applicants
  console.log('=' .repeat(80));
  console.log(`QUALIFIED APPLICANTS (${qualified.length}) - Should score HIGH`);
  console.log('=' .repeat(80));

  for (const { offer, user, signals } of qualified) {
    console.log(`\n✅ ${offer.Lblr_FirstName || user.userfirstName || ''} ${offer.Lblr_LastName || user.userlastName || ''}`);
    console.log(`   Status: ${offer.Offer_Status}`);
    if (offer['AI Interview Score']) console.log(`   AI Interview Score: ${offer['AI Interview Score']}`);
    console.log(`   Qualification signals: ${signals.join(', ')}`);
    if (user.lblr_ProfileTitle) console.log(`   Title: ${user.lblr_ProfileTitle}`);
    if (user.lblr_ProfileDescription) {
      const desc = user.lblr_ProfileDescription.slice(0, 300).replace(/\n/g, ' ');
      console.log(`   Profile: ${desc}...`);
    }
    if (user.lblr_freelancer3SubjectMatter?.length) {
      console.log(`   Subject Matter: ${user.lblr_freelancer3SubjectMatter.join(', ')}`);
    }
  }

  // Show sample of unqualified applicants
  console.log('\n\n' + '=' .repeat(80));
  console.log(`UNQUALIFIED APPLICANTS (${unqualified.length}) - Should score LOW`);
  console.log('=' .repeat(80));

  const unqualifiedSample = unqualified.slice(0, 10);
  for (const { offer, user, signals } of unqualifiedSample) {
    const name = offer.Lblr_FirstName || user?.userfirstName || 'Unknown';
    const lastName = offer.Lblr_LastName || user?.userlastName || '';
    console.log(`\n❌ ${name} ${lastName}`);
    console.log(`   Status: ${offer.Offer_Status}`);
    if (offer['AI Interview Score']) console.log(`   AI Interview Score: ${offer['AI Interview Score']}`);
    console.log(`   Signals found: ${signals.length > 0 ? signals.join(', ') : 'None'}`);
    if (user?.lblr_ProfileTitle) console.log(`   Title: ${user.lblr_ProfileTitle}`);
    if (user?.lblr_freelancer3SubjectMatter?.length) {
      console.log(`   Subject Matter: ${user.lblr_freelancer3SubjectMatter.join(', ')}`);
    }
  }

  // Summary
  console.log('\n\n' + '=' .repeat(80));
  console.log('SUMMARY - Expected Matching Behavior');
  console.log('=' .repeat(80));

  const hiredOffers = offers.filter(o => o.Offer_Status === 'Hired');
  const notFitOffers = offers.filter(o => o.Offer_Status === 'Not a fit');

  console.log(`
Total applicants: ${offers.length}
Qualified (has medical credentials): ${qualified.length} (${Math.round(qualified.length/offers.length*100)}%)
Unqualified: ${unqualified.length} (${Math.round(unqualified.length/offers.length*100)}%)

Status breakdown:
- Hired: ${hiredOffers.length}
- Not a fit: ${notFitOffers.length}
- Other: ${offers.length - hiredOffers.length - notFitOffers.length}

EXPECTED MATCHING SCORES (OBGYN job weights: 85% domain, 15% task):
- Qualified MDs with OBGYN background: ~0.75-0.90 (high domain similarity)
- Nurses/healthcare workers: ~0.40-0.60 (partial domain match)
- General labelers (no medical): ~0.10-0.25 (low domain similarity)

This creates a SHARP DROPOFF between qualified and unqualified candidates.
`);
}

main().catch(console.error);
