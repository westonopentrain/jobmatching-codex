import { classifyJobSync, getWeightProfile } from '../src/services/job-classifier';
import { NormalizedJobPosting } from '../src/utils/types';

// Real OBGYN job from Bubble
const obgynJob: NormalizedJobPosting = {
  jobId: '1733994253353x683525100278382600',
  title: 'OBGYN Doctors - Large Language Model Training',
  dataSubjectMatter: 'OBGYN',
  expertiseLevel: 'Entry Level',  // Note: says Entry Level but requires MD!
  requirementsAdditional: `-MD degree with completed residency in Obstetrics and Gynecology.
-Minimum of 5 years of clinical experience in OBGYN.
-Strong English writing skills for clear and precise communication.
-Ability to review, validate, and refine medical content for accuracy and accessibility.
-Preferred availability of at least 15 hours per week (not required).`,
  instructions: `OpenTrain AI is seeking experienced OBGYN doctors to help train an AI chatbot specializing in obstetrics and gynecology. Candidates must have at least five years of clinical experience, an MD degree, completed OBGYN residency, and strong English writing skills.`,
  datasetDescription: 'Various topics in the OBGYN field',
  labelTypes: ['Evaluation/Rating', 'Prompt + Response Writing (SFT)'],
  availableLanguages: ['English'],
  availableCountries: ['Australia', 'Canada', 'India', 'Philippines', 'United Kingdom', 'USA'],
  additionalSkills: [],
  promptText: '',
  sourceText: '',
};

const result = classifyJobSync(obgynJob);
const weights = getWeightProfile(result.jobClass);

console.log('\n=== OBGYN Job Classification ===');
console.log('Job ID:', obgynJob.jobId);
console.log('Title:', obgynJob.title);
console.log('Bubble ExpertiseLevel:', obgynJob.expertiseLevel);
console.log('\n--- Classification Result ---');
console.log('Job Class:', result.jobClass);
console.log('Confidence:', result.confidence);
console.log('Reasoning:', result.reasoning);
console.log('\n--- Recommended Weights ---');
console.log('Domain Weight:', weights.w_domain);
console.log('Task Weight:', weights.w_task);
