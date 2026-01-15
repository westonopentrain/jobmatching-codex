/**
 * Test matching scores for Angular Code Reviewer job
 */

import { embedText } from '../src/services/embeddings';
import { classifyJob, getWeightProfile } from '../src/services/job-classifier';
import { NormalizedJobPosting, NormalizedUserProfile } from '../src/utils/types';
import { generateCapsules } from '../src/services/capsules';

const BUBBLE_API = 'https://app.opentrain.ai/version-02wlo/api/1.1/obj';
const API_KEY = 'ac589face4818ffaeec13163c764dbc7';

const ANGULAR_JOB_ID = '1751971673741x217179543502848000';

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

async function main() {
  console.log('=' .repeat(80));
  console.log('ANGULAR CODE REVIEWER JOB - SIMILARITY SCORES');
  console.log('=' .repeat(80));

  // Fetch and process job
  console.log('\n📋 Processing Angular Code Reviewer job...');
  const bubbleJob = await fetchJob(ANGULAR_JOB_ID);
  const normalizedJob = bubbleJobToNormalized(bubbleJob);

  console.log('   Title: ' + normalizedJob.title);
  console.log('   Subject: ' + normalizedJob.dataSubjectMatter);
  console.log('   Requirements: ' + (normalizedJob.requirementsAdditional || '').slice(0, 200) + '...');

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

  console.log('\n   Job Domain Capsule: ' + jobCapsules.domain.text.slice(0, 100) + '...');

  // Get job embedding
  const jobDomainEmbedding = await embedText(jobCapsules.domain.text);
  const jobTaskEmbedding = await embedText(jobCapsules.task.text);

  // Classify job
  const jobClassification = await classifyJob(normalizedJob);
  const weights = getWeightProfile(jobClassification.jobClass);

  console.log('\n   Classification: ' + jobClassification.jobClass.toUpperCase());
  console.log('   Confidence: ' + jobClassification.confidence);
  console.log('   Reasoning: ' + jobClassification.reasoning);
  console.log('   Weights: domain=' + weights.w_domain + ', task=' + weights.w_task);

  // Get offers
  const offers = await fetchJobOffers(ANGULAR_JOB_ID);

  // Get all offers with status
  const hiredOffers = offers.filter(o => o.Offer_Status === 'Hired');
  const notFitOffers = offers.filter(o => o.Offer_Status === 'Not a fit');
  const unreviewedOffers = offers.filter(o => o.Offer_Status === 'Unreviewed');

  console.log('\n   Total proposals: ' + offers.length);
  console.log('   Hired: ' + hiredOffers.length + ', Not a fit: ' + notFitOffers.length + ', Unreviewed: ' + unreviewedOffers.length);

  // Select sample: hired + not a fit + some unreviewed
  const sampleOffers = [
    ...hiredOffers.slice(0, 3),
    ...notFitOffers.slice(0, 5),
    ...unreviewedOffers.slice(0, 2),
  ];

  console.log('\n👥 Computing similarity scores for ' + sampleOffers.length + ' sample applicants...\n');

  const results: {
    name: string;
    status: string;
    aiScore: number | undefined;
    domainSim: number;
    taskSim: number;
    finalScore: number;
    title: string;
  }[] = [];

  for (const offer of sampleOffers) {
    const userId = offer.Labeler || offer['Created By'];
    if (!userId) continue;

    const user = await fetchUser(userId);
    if (!user) continue;

    const normalizedUser = bubbleUserToNormalized(user);

    // Generate user capsules
    const userCapsules = await generateCapsules(normalizedUser);

    // Get user embeddings
    const userDomainEmbedding = await embedText(userCapsules.domain.text);
    const userTaskEmbedding = await embedText(userCapsules.task.text);

    // Calculate similarities
    const domainSim = cosineSimilarity(jobDomainEmbedding, userDomainEmbedding);
    const taskSim = cosineSimilarity(jobTaskEmbedding, userTaskEmbedding);

    // Calculate final score using weights
    const finalScore = weights.w_domain * domainSim + weights.w_task * taskSim;

    results.push({
      name: (offer.Lblr_FirstName || user.userfirstName || '') + ' ' + (offer.Lblr_LastName || user.userlastName || ''),
      status: offer.Offer_Status || 'Unknown',
      aiScore: offer['AI Interview Score'],
      domainSim,
      taskSim,
      finalScore,
      title: user.lblr_ProfileTitle || 'N/A',
    });

    console.log('   Processed: ' + results[results.length - 1]!.name);
  }

  // Sort by final score
  results.sort((a, b) => b.finalScore - a.finalScore);

  console.log('\n' + '=' .repeat(80));
  console.log('RESULTS - Sorted by Final Match Score');
  console.log('=' .repeat(80));
  console.log('\nFormula: Final = ' + weights.w_domain + ' × Domain + ' + weights.w_task + ' × Task\n');

  console.log('Name'.padEnd(25) + 'Status'.padEnd(14) + 'Domain'.padEnd(10) + 'Task'.padEnd(10) + 'FINAL'.padEnd(10) + 'Title');
  console.log('-'.repeat(110));

  for (const r of results) {
    const statusEmoji = r.status === 'Hired' ? '✅' : r.status === 'Not a fit' ? '❌' : '⏳';
    console.log(
      statusEmoji + ' ' + r.name.slice(0, 22).padEnd(22) + ' ' +
      r.status.padEnd(14) +
      r.domainSim.toFixed(3).padEnd(10) +
      r.taskSim.toFixed(3).padEnd(10) +
      r.finalScore.toFixed(3).padEnd(10) +
      r.title.slice(0, 40)
    );
  }

  // Show the dropoff
  const hiredScores = results.filter(r => r.status === 'Hired').map(r => r.finalScore);
  const notFitScores = results.filter(r => r.status === 'Not a fit').map(r => r.finalScore);

  if (hiredScores.length > 0 && notFitScores.length > 0) {
    const avgHired = hiredScores.reduce((a, b) => a + b, 0) / hiredScores.length;
    const avgNotFit = notFitScores.reduce((a, b) => a + b, 0) / notFitScores.length;
    const dropoff = avgHired - avgNotFit;
    const dropoffPct = (dropoff / avgNotFit * 100).toFixed(0);

    console.log('\n' + '=' .repeat(80));
    console.log('SCORE ANALYSIS');
    console.log('=' .repeat(80));
    console.log('\nAverage score - HIRED candidates: ' + avgHired.toFixed(3));
    console.log('Average score - NOT A FIT candidates: ' + avgNotFit.toFixed(3));
    console.log('DROPOFF: ' + dropoff.toFixed(3) + ' (' + dropoffPct + '% higher for qualified)');
  }
}

main().catch(console.error);
