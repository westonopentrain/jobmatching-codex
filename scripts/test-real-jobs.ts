/**
 * Test matching scores for jobs with REAL hires
 */

import { embedText } from '../src/services/embeddings';
import { classifyJob, getWeightProfile } from '../src/services/job-classifier';
import { NormalizedJobPosting, NormalizedUserProfile } from '../src/utils/types';
import { generateCapsules } from '../src/services/capsules';

const BUBBLE_API = 'https://app.opentrain.ai/version-02wlo/api/1.1/obj';
const API_KEY = 'ac589face4818ffaeec13163c764dbc7';

// Jobs with REAL hires
const JOBS_TO_TEST = [
  { id: '1742302789241x752029533143040000', name: 'LLM Summary Evaluation (US/Canada English)' },
  { id: '1722932177934x195359492446617600', name: 'German Web Developer (HTML/CSS/JS)' },
];

interface BubbleJob {
  _id: string;
  Title?: string;
  Data_SubjectMatter?: string;
  ExpertiseLevel?: string;
  Requirements_Additional?: string;
  'LabelInstruct/Descri'?: string;
  LabelType?: string[];
  'Dataset Description'?: string;
}

interface BubbleJobOffer {
  _id: string;
  Job?: string;
  Labeler?: string;
  'Created By'?: string;
  Offer_Status?: string;
  'AI Interview Score'?: number;
  Lblr_FirstName?: string;
  Lblr_LastName?: string;
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
  lblr_Software?: string[];
}

async function fetchJob(id: string): Promise<BubbleJob> {
  const response = await fetch(`${BUBBLE_API}/Job/${id}`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  const data = await response.json() as { response: BubbleJob };
  return data.response;
}

async function fetchJobOffers(jobId: string): Promise<BubbleJobOffer[]> {
  const constraint = encodeURIComponent(JSON.stringify([{ key: 'Job', constraint_type: 'equals', value: jobId }]));
  const response = await fetch(`${BUBBLE_API}/jobOffer?constraints=${constraint}&limit=200`, {
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

function bubbleJobToNormalized(job: BubbleJob): NormalizedJobPosting {
  const normalized: NormalizedJobPosting = {
    jobId: job._id,
    labelTypes: job.LabelType || [],
    availableLanguages: [],
    availableCountries: [],
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
    ...(user.lblr_freelancer3SubjectMatter || []),
  ].filter((x): x is string => typeof x === 'string' && x.length > 0);

  const education = typeof user.lblr_Education === 'string' ? [user.lblr_Education] : [];
  const labeling = (user.lblr_Software || []).filter((x): x is string => typeof x === 'string');

  return {
    userId: user._id,
    resumeText: resumeParts.join('\n\n') || 'No profile provided',
    workExperience: [],
    education,
    labelingExperience: labeling,
    languages: [],
  };
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function testJob(jobId: string, jobName: string) {
  console.log('\n' + '='.repeat(80));
  console.log('JOB: ' + jobName);
  console.log('='.repeat(80));

  // Fetch and process job
  const bubbleJob = await fetchJob(jobId);
  const normalizedJob = bubbleJobToNormalized(bubbleJob);

  console.log('\nTitle: ' + normalizedJob.title);
  console.log('Subject: ' + normalizedJob.dataSubjectMatter);
  console.log('Level: ' + normalizedJob.expertiseLevel);
  const reqPreview = (normalizedJob.requirementsAdditional || '').slice(0, 300).replace(/\n/g, ' ');
  console.log('Requirements: ' + reqPreview + '...');

  // Classify job
  const jobClassification = await classifyJob(normalizedJob);
  const weights = getWeightProfile(jobClassification.jobClass);

  console.log('\nClassification: ' + jobClassification.jobClass.toUpperCase());
  console.log('Confidence: ' + jobClassification.confidence);
  console.log('Reasoning: ' + jobClassification.reasoning);
  console.log('Weights: domain=' + weights.w_domain + ', task=' + weights.w_task);

  // Generate job capsules
  const jobCapsules = await generateCapsules({
    userId: 'job',
    resumeText: [
      normalizedJob.title,
      normalizedJob.dataSubjectMatter,
      normalizedJob.requirementsAdditional,
      normalizedJob.instructions,
    ].filter(Boolean).join('\n\n'),
    workExperience: [],
    education: [],
    labelingExperience: [],
    languages: [],
  });

  // Get job embeddings
  const jobDomainEmbedding = await embedText(jobCapsules.domain.text);
  const jobTaskEmbedding = await embedText(jobCapsules.task.text);

  // Get offers
  const offers = await fetchJobOffers(jobId);
  const hiredOffers = offers.filter(o => o.Offer_Status === 'Hired');
  const notFitOffers = offers.filter(o => o.Offer_Status === 'Not a fit');

  console.log('\nTotal proposals: ' + offers.length);
  console.log('Hired: ' + hiredOffers.length + ', Not a fit: ' + notFitOffers.length);

  // Sample: all hired + some not a fit
  const sampleOffers = [
    ...hiredOffers.slice(0, 5),
    ...notFitOffers.slice(0, 5),
  ];

  console.log('\nComputing scores for ' + sampleOffers.length + ' applicants...\n');

  const results: {
    name: string;
    status: string;
    domainSim: number;
    taskSim: number;
    finalScore: number;
    title: string;
    subjects: string;
  }[] = [];

  for (const offer of sampleOffers) {
    const userId = offer.Labeler || offer['Created By'];
    if (!userId) continue;

    const user = await fetchUser(userId);
    if (!user) continue;

    const normalizedUser = bubbleUserToNormalized(user);
    const userCapsules = await generateCapsules(normalizedUser);
    const userDomainEmbedding = await embedText(userCapsules.domain.text);
    const userTaskEmbedding = await embedText(userCapsules.task.text);

    const domainSim = cosineSimilarity(jobDomainEmbedding, userDomainEmbedding);
    const taskSim = cosineSimilarity(jobTaskEmbedding, userTaskEmbedding);
    const finalScore = weights.w_domain * domainSim + weights.w_task * taskSim;

    results.push({
      name: (offer.Lblr_FirstName || user.userfirstName || '') + ' ' + (offer.Lblr_LastName || user.userlastName || ''),
      status: offer.Offer_Status || 'Unknown',
      domainSim,
      taskSim,
      finalScore,
      title: user.lblr_ProfileTitle || 'N/A',
      subjects: (user.lblr_freelancer3SubjectMatter || []).join(', ').slice(0, 50),
    });

    process.stdout.write('.');
  }
  console.log(' done\n');

  // Sort by final score
  results.sort((a, b) => b.finalScore - a.finalScore);

  // Display results
  console.log('-'.repeat(110));
  console.log('Name'.padEnd(22) + 'Status'.padEnd(12) + 'Domain'.padEnd(8) + 'Task'.padEnd(8) + 'FINAL'.padEnd(8) + 'Profile Title');
  console.log('-'.repeat(110));

  for (const r of results) {
    const emoji = r.status === 'Hired' ? '✅' : '❌';
    console.log(
      emoji + ' ' + r.name.slice(0, 19).padEnd(19) + ' ' +
      r.status.slice(0, 10).padEnd(12) +
      r.domainSim.toFixed(2).padEnd(8) +
      r.taskSim.toFixed(2).padEnd(8) +
      r.finalScore.toFixed(3).padEnd(8) +
      r.title.slice(0, 45)
    );
  }

  // Analysis
  const hiredScores = results.filter(r => r.status === 'Hired').map(r => r.finalScore);
  const notFitScores = results.filter(r => r.status === 'Not a fit').map(r => r.finalScore);

  if (hiredScores.length > 0 && notFitScores.length > 0) {
    const avgHired = hiredScores.reduce((a, b) => a + b, 0) / hiredScores.length;
    const avgNotFit = notFitScores.reduce((a, b) => a + b, 0) / notFitScores.length;
    const minHired = Math.min(...hiredScores);
    const maxNotFit = Math.max(...notFitScores);

    console.log('\n--- ANALYSIS ---');
    console.log('Avg HIRED: ' + avgHired.toFixed(3) + ' | Avg NOT A FIT: ' + avgNotFit.toFixed(3));
    console.log('Min HIRED: ' + minHired.toFixed(3) + ' | Max NOT A FIT: ' + maxNotFit.toFixed(3));
    console.log('Gap: ' + (avgHired - avgNotFit).toFixed(3) + ' (' + ((avgHired - avgNotFit) / avgNotFit * 100).toFixed(0) + '% higher)');

    if (minHired > maxNotFit) {
      console.log('✅ CLEAN SEPARATION: All hired score higher than all rejected');
    } else {
      console.log('⚠️  OVERLAP: Some rejected scored higher than some hired');
    }
  }
}

async function main() {
  console.log('Testing matching scores on jobs with REAL hires\n');

  for (const job of JOBS_TO_TEST) {
    await testJob(job.id, job.name);
  }

  console.log('\n' + '='.repeat(80));
  console.log('TESTING COMPLETE');
  console.log('='.repeat(80));
}

main().catch(console.error);
