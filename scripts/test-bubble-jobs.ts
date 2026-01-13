/**
 * Test classifier against real Bubble jobs
 */
import { classifyJob, getWeightProfile } from '../src/services/job-classifier';
import { NormalizedJobPosting } from '../src/utils/types';

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

function bubbleToNormalized(job: BubbleJob): NormalizedJobPosting {
  return {
    jobId: job._id,
    title: job.Title,
    dataSubjectMatter: job.Data_SubjectMatter,
    expertiseLevel: job.ExpertiseLevel,
    requirementsAdditional: job.Requirements_Additional,
    instructions: job['LabelInstruct/Descri'],
    datasetDescription: job['Dataset Description'],
    labelTypes: job.LabelType || [],
    availableLanguages: job.AvailableLanguages || [],
    availableCountries: job.AvailableCountries || [],
    additionalSkills: [],
    promptText: '',
    sourceText: '',
  };
}

async function fetchJobs(limit: number = 100): Promise<BubbleJob[]> {
  const response = await fetch(`${BUBBLE_API}/Job?limit=${limit}&sort_field=Modified%20Date&descending=true`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  const data = await response.json();
  return data.response.results;
}

async function fetchJobById(id: string): Promise<BubbleJob> {
  const response = await fetch(`${BUBBLE_API}/Job/${id}`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  const data = await response.json();
  return data.response;
}

function isRealJob(job: BubbleJob): boolean {
  const title = (job.Title || '').toLowerCase();
  return job.Title != null &&
    !title.includes('sample') &&
    !title.includes('example') &&
    !title.includes('test') &&
    title.length > 5;
}

async function main() {
  console.log('Fetching jobs from Bubble...\n');

  // Fetch the OBGYN job specifically (known specialized job)
  const obgynJob = await fetchJobById('1733994253353x683525100278382600');

  // Fetch recent jobs and filter to real ones
  const allJobs = await fetchJobs(100);
  const realJobs = allJobs.filter(isRealJob);

  // Combine - put OBGYN first, test 20 jobs
  const jobs = [obgynJob, ...realJobs.filter(j => j._id !== obgynJob._id)].slice(0, 20);

  console.log('='.repeat(80));
  console.log(`JOB CLASSIFICATION RESULTS (${jobs.length} real jobs)`);
  console.log('='.repeat(80));

  const results: { specialized: number; generic: number } = { specialized: 0, generic: 0 };

  for (const bubbleJob of jobs) {
    const normalized = bubbleToNormalized(bubbleJob);
    const classification = await classifyJob(normalized);  // Use LLM-based classification
    const weights = getWeightProfile(classification.jobClass);

    results[classification.jobClass]++;

    console.log(`\n[${classification.jobClass.toUpperCase()}] ${normalized.title || 'Untitled'}`);
    console.log(`  Bubble Expertise: ${normalized.expertiseLevel || 'N/A'}`);
    console.log(`  Subject Matter: ${normalized.dataSubjectMatter || 'N/A'}`);

    // Show LLM reasoning for classification
    console.log(`  Confidence: ${classification.confidence}`);
    if (classification.reasoning) {
      console.log(`  Reasoning: ${classification.reasoning}`);
    }
    if (classification.requirements.credentials.length > 0) {
      console.log(`  Required Credentials: ${classification.requirements.credentials.join(', ')}`);
    }

    // Show weights that would be used
    console.log(`  Weights: domain=${weights.w_domain}, task=${weights.w_task}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Specialized jobs: ${results.specialized}`);
  console.log(`Generic jobs: ${results.generic}`);
  console.log(`Total: ${results.specialized + results.generic}`);
}

main().catch(console.error);
