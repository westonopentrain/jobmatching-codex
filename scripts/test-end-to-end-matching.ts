/**
 * End-to-end matching test with real Bubble data.
 *
 * This script demonstrates the full matching flow:
 * 1. Fetch real jobs from Bubble (specialized + generic)
 * 2. Fetch real users from Bubble
 * 3. Classify jobs to determine weights
 * 4. Show how users would be matched based on weights
 */

import { classifyJob, getWeightProfile } from '../src/services/job-classifier';
import { NormalizedJobPosting, NormalizedUserProfile } from '../src/utils/types';

const BUBBLE_API = 'https://app.opentrain.ai/version-02wlo/api/1.1/obj';
const API_KEY = 'ac589face4818ffaeec13163c764dbc7';

interface BubbleJob {
  _id: string;
  Title?: string;
  Data_SubjectMatter?: string;
  ExpertiseLevel?: string;
  Requirements_Additional?: string;
  'LabelInstruct/Descri'?: string;
  LabelType?: string[];
  AvailableLanguages?: string[];
  AvailableCountries?: string[];
  'Dataset Description'?: string;
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
}

function bubbleJobToNormalized(job: BubbleJob): NormalizedJobPosting {
  const normalized: NormalizedJobPosting = {
    jobId: job._id,
    labelTypes: job.LabelType || [],
    availableLanguages: job.AvailableLanguages || [],
    availableCountries: job.AvailableCountries || [],
    additionalSkills: [],
    promptText: '',
    sourceText: '',
  };

  if (job.Title) normalized.title = job.Title;
  if (job.Data_SubjectMatter) normalized.dataSubjectMatter = job.Data_SubjectMatter;
  if (job.ExpertiseLevel) normalized.expertiseLevel = job.ExpertiseLevel;
  if (job.Requirements_Additional) normalized.requirementsAdditional = job.Requirements_Additional;
  if (job['LabelInstruct/Descri']) normalized.instructions = job['LabelInstruct/Descri'];
  if (job['Dataset Description']) normalized.datasetDescription = job['Dataset Description'];

  return normalized;
}

function bubbleUserToNormalized(user: BubbleUser): NormalizedUserProfile {
  const resumeParts = [
    user.lblr_ProfileTitle,
    user.lblr_ProfileDescription,
    user.lblr_Education,
    user.lblr_LabelExperience,
  ].filter(Boolean);

  return {
    userId: user._id,
    resumeText: resumeParts.join('\n\n'),
    workExperience: [],
    education: user.lblr_Education ? [user.lblr_Education] : [],
    labelingExperience: user.lblr_Software || [],
    languages: [],
  };
}

async function fetchJob(id: string): Promise<BubbleJob> {
  const response = await fetch(`${BUBBLE_API}/Job/${id}`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  const data = await response.json() as { response: BubbleJob };
  return data.response;
}

async function fetchJobs(limit: number = 20): Promise<BubbleJob[]> {
  const response = await fetch(`${BUBBLE_API}/Job?limit=${limit}&sort_field=Modified%20Date&descending=true`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  const data = await response.json() as { response: { results: BubbleJob[] } };
  return data.response.results;
}

async function fetchUsers(limit: number = 50): Promise<BubbleUser[]> {
  const response = await fetch(`${BUBBLE_API}/User?limit=${limit}`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  const data = await response.json() as { response: { results: BubbleUser[] } };
  return data.response.results;
}

function hasUserContent(user: BubbleUser): boolean {
  return !!(user.lblr_ProfileTitle || user.lblr_ProfileDescription || user.lblr_LabelExperience);
}

async function main() {
  console.log('=' .repeat(80));
  console.log('END-TO-END MATCHING TEST');
  console.log('=' .repeat(80));

  // Fetch the OBGYN job (known specialized job)
  console.log('\n📋 Fetching jobs from Bubble...');
  const obgynJob = await fetchJob('1733994253353x683525100278382600');
  const allJobs = await fetchJobs(50);

  // Find a generic job for comparison
  const realJobs = allJobs.filter(j =>
    j.Title &&
    !j.Title.toLowerCase().includes('test') &&
    !j.Title.toLowerCase().includes('sample')
  );

  // Fetch users
  console.log('👥 Fetching users from Bubble...');
  const allUsers = await fetchUsers(100);
  const usersWithContent = allUsers.filter(hasUserContent);

  console.log(`   Found ${realJobs.length} real jobs, ${usersWithContent.length} users with profiles\n`);

  // Test specialized job (OBGYN)
  console.log('=' .repeat(80));
  console.log('TEST 1: SPECIALIZED JOB (OBGYN Doctors)');
  console.log('=' .repeat(80));

  const normalizedObgyn = bubbleJobToNormalized(obgynJob);
  const obgynClassification = await classifyJob(normalizedObgyn);
  const obgynWeights = getWeightProfile(obgynClassification.jobClass);

  console.log(`\n📌 Job: ${normalizedObgyn.title}`);
  console.log(`   Classification: ${obgynClassification.jobClass.toUpperCase()}`);
  console.log(`   Confidence: ${obgynClassification.confidence}`);
  console.log(`   Reasoning: ${obgynClassification.reasoning}`);
  console.log(`\n⚖️  Matching Weights:`);
  console.log(`   Domain weight: ${obgynWeights.w_domain} (${obgynWeights.w_domain * 100}%)`);
  console.log(`   Task weight: ${obgynWeights.w_task} (${obgynWeights.w_task * 100}%)`);
  console.log(`\n   → This means domain expertise (medical/OBGYN) counts for 85% of the match score`);
  console.log(`   → Labeling experience only counts for 15%`);
  console.log(`   → Users with OBGYN/medical background will rank highest`);

  // Find a generic job
  let genericJob: BubbleJob | undefined;
  for (const job of realJobs) {
    const normalized = bubbleJobToNormalized(job);
    const classification = await classifyJob(normalized);
    if (classification.jobClass === 'generic') {
      genericJob = job;
      break;
    }
  }

  if (genericJob) {
    console.log('\n\n' + '=' .repeat(80));
    console.log('TEST 2: GENERIC JOB (Data Labeling)');
    console.log('=' .repeat(80));

    const normalizedGeneric = bubbleJobToNormalized(genericJob);
    const genericClassification = await classifyJob(normalizedGeneric);
    const genericWeights = getWeightProfile(genericClassification.jobClass);

    console.log(`\n📌 Job: ${normalizedGeneric.title}`);
    console.log(`   Classification: ${genericClassification.jobClass.toUpperCase()}`);
    console.log(`   Confidence: ${genericClassification.confidence}`);
    console.log(`   Reasoning: ${genericClassification.reasoning}`);
    console.log(`\n⚖️  Matching Weights:`);
    console.log(`   Domain weight: ${genericWeights.w_domain} (${genericWeights.w_domain * 100}%)`);
    console.log(`   Task weight: ${genericWeights.w_task} (${genericWeights.w_task * 100}%)`);
    console.log(`\n   → This means labeling/task experience counts for 70% of the match score`);
    console.log(`   → Domain expertise only counts for 30%`);
    console.log(`   → Users with annotation experience (Scale AI, Appen, etc.) will rank highest`);
  }

  // Show sample users and how they'd be matched
  console.log('\n\n' + '=' .repeat(80));
  console.log('SAMPLE USERS (showing what would be matched)');
  console.log('=' .repeat(80));

  const sampleUsers = usersWithContent.slice(0, 5);
  for (const user of sampleUsers) {
    console.log(`\n👤 ${user.userfirstName || ''} ${user.userlastName || ''}`);
    if (user.lblr_ProfileTitle) console.log(`   Title: ${user.lblr_ProfileTitle}`);
    if (user.lblr_freelancer3SubjectMatter?.length) {
      console.log(`   Subject Matter: ${user.lblr_freelancer3SubjectMatter.join(', ')}`);
    }
    if (user.lblr_freelancer5LabelTypes?.length) {
      console.log(`   Label Types: ${user.lblr_freelancer5LabelTypes.join(', ')}`);
    }
    if (user.lblr_Software?.length) {
      console.log(`   Platforms: ${user.lblr_Software.join(', ')}`);
    }

    // Indicate likely match
    const hasLabelingExp = user.lblr_Software && user.lblr_Software.length > 0;
    const hasMedicalExp = user.lblr_freelancer3SubjectMatter?.some(s =>
      s.toLowerCase().includes('medic') || s.toLowerCase().includes('health')
    );

    console.log(`   → For SPECIALIZED jobs: ${hasMedicalExp ? '✅ Good match (has relevant domain)' : '❌ Weak match (no domain expertise)'}`);
    console.log(`   → For GENERIC jobs: ${hasLabelingExp ? '✅ Good match (has labeling experience)' : '⚠️ Moderate match'}`);
  }

  console.log('\n\n' + '=' .repeat(80));
  console.log('SUMMARY');
  console.log('=' .repeat(80));
  console.log(`
The matching system works as follows:

1. When a job is posted, it's classified as SPECIALIZED or GENERIC
2. Classification determines the weight profile:
   - SPECIALIZED: 85% domain, 15% task (expertise matters most)
   - GENERIC: 30% domain, 70% task (labeling experience matters most)

3. Each user has two "capsules" (semantic embeddings):
   - Domain capsule: captures their professional expertise
   - Task capsule: captures their labeling/annotation skills

4. Matching score = (domain_weight × domain_similarity) + (task_weight × task_similarity)

5. Users are ranked by their blended score for each job

This means:
- MDs get matched to medical AI training jobs
- Experienced labelers get matched to annotation jobs
- The system naturally routes the right people to the right jobs
`);
}

main().catch(console.error);
