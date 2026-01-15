/**
 * Explore Bubble user data to understand what we're working with
 */

const BUBBLE_API = 'https://app.opentrain.ai/version-02wlo/api/1.1/obj';
const API_KEY = 'ac589face4818ffaeec13163c764dbc7';

interface BubbleUser {
  _id: string;
  userfirstName?: string;
  userlastName?: string;
  lblr_ProfileTitle?: string;
  lblr_ProfileDescription?: string;
  lblr_Education?: string;
  lblr_LabelExperience?: string;
  lblr_freelancerWorkExperience?: unknown;
  lblr_freelancer3SubjectMatter?: string[];
  lblr_freelancer5LabelTypes?: string[];
  lblr_ExpertiseLevel?: string;
  lblr_Software?: string[];
  lblr_Languages?: string[];
  userCountry?: string;
  [key: string]: unknown;
}

async function fetchUsers(limit: number = 100): Promise<BubbleUser[]> {
  const response = await fetch(`${BUBBLE_API}/User?limit=${limit}`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  const data = await response.json() as { response: { results: BubbleUser[] } };
  return data.response.results;
}

function hasContent(user: BubbleUser): boolean {
  return !!(user.lblr_ProfileTitle || user.lblr_ProfileDescription ||
            user.lblr_LabelExperience || user.lblr_freelancerWorkExperience);
}

function stringify(val: unknown): string {
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return val.join(', ');
  return String(val || '');
}

// Check for domain expert signals
function hasDomainExpertSignals(user: BubbleUser): boolean {
  const text = [
    user.lblr_ProfileTitle,
    user.lblr_ProfileDescription,
    user.lblr_Education,
    stringify(user.lblr_freelancerWorkExperience),
  ].filter(Boolean).join(' ').toLowerCase();

  return /\b(md|phd|jd|doctor|physician|attorney|lawyer|engineer|professor|scientist|nurse|pharmacist|cpa|pe)\b/i.test(text);
}

async function main() {
  console.log('Fetching users from Bubble...\n');

  const allUsers = await fetchUsers(100);
  const users = allUsers.filter(hasContent);

  console.log(`Found ${allUsers.length} total users, ${users.length} with profile content\n`);

  // Find potential domain experts
  const domainExperts = users.filter(hasDomainExpertSignals);
  const labelers = users.filter(u => !hasDomainExpertSignals(u));

  console.log('='.repeat(80));
  console.log(`POTENTIAL DOMAIN EXPERTS: ${domainExperts.length}`);
  console.log('='.repeat(80));

  for (const user of domainExperts.slice(0, 10)) {
    console.log(`\n[EXPERT] ${user.userfirstName || ''} ${user.userlastName || ''}`);
    if (user.lblr_ProfileTitle) console.log(`  Title: ${user.lblr_ProfileTitle}`);
    if (user.lblr_Education) console.log(`  Education: ${user.lblr_Education.slice(0, 200)}`);
    if (user.lblr_ProfileDescription) {
      console.log(`  Description: ${user.lblr_ProfileDescription.slice(0, 300).replace(/\n/g, ' ')}`);
    }
    if (user.lblr_freelancer3SubjectMatter?.length) {
      console.log(`  Subject Matter: ${user.lblr_freelancer3SubjectMatter.join(', ')}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`GENERAL LABELERS (sample): ${labelers.length}`);
  console.log('='.repeat(80));

  for (const user of labelers.slice(0, 5)) {
    console.log(`\n[LABELER] ${user.userfirstName || ''} ${user.userlastName || ''}`);
    if (user.lblr_ProfileTitle) console.log(`  Title: ${user.lblr_ProfileTitle}`);
    if (user.lblr_ExpertiseLevel) console.log(`  Level: ${user.lblr_ExpertiseLevel}`);
    if (user.lblr_freelancer5LabelTypes?.length) {
      console.log(`  Label Types: ${user.lblr_freelancer5LabelTypes.join(', ')}`);
    }
    if (user.lblr_Software?.length) {
      console.log(`  Software: ${user.lblr_Software.join(', ')}`);
    }
  }

  const expertPct = Math.round(domainExperts.length / users.length * 100);
  const labelerPct = Math.round(labelers.length / users.length * 100);

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY:');
  console.log(`  Potential domain experts: ${domainExperts.length} (${expertPct}%)`);
  console.log(`  General labelers: ${labelers.length} (${labelerPct}%)`);
}

main().catch(console.error);
