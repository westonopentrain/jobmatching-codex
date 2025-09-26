import { getOpenAIClient } from './openai-client';
import { resolveCapsuleModel } from './openai-model';
import { withRetry } from '../utils/retry';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { extractCapsuleTexts } from './capsules';
import { sanitizeJobField, sanitizeJobStringArray } from '../utils/sanitize';
import { CapsulePair, NormalizedJobPosting, UpsertJobRequest } from '../utils/types';
import { validateJobDomainCapsule, validateJobTaskCapsule } from './job-validate';

const JOB_CAPSULE_SYSTEM_MESSAGE =
  'You generate Job Domain and Task capsules for vector search in a job marketplace. Use only facts from the provided job fields.';

const CAPSULE_TEMPERATURE = 0.2;

interface PromptOverrides {
  domainDirective?: string;
  taskDirective?: string;
}

function assertHasFields(pairs: Array<[string, string]>): void {
  if (pairs.length === 0) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      message: 'At least one job field must be provided',
    });
  }
}

function formatPairsForPrompt(pairs: Array<[string, string]>): string {
  return pairs.map(([label, value]) => `${label}: ${value}`).join('\n');
}

function buildPrompt(job: NormalizedJobPosting, overrides: PromptOverrides): string {
  const basePrompt = `You must produce EXACTLY two blocks in this order.

Block 1 — Job Domain Capsule
- Be domain-agnostic (works for medicine, software, writing, finance, legal, etc.).
- Use ONLY facts in the job. Do NOT invent anything.
- Produce a compact, noun-dense paragraph listing subject-matter nouns ONLY (specialties, subdisciplines, procedures, frameworks, standards, credentials, settings, data types).
- Omit AI/LLM labeling/evaluation/training terms, tools, or QA.
- Avoid roles, process narratives, or boilerplate.
- Target 80-160 words (<=200 hard cap).
- End with: Keywords: <10-20 domain tokens that already appear in the capsule AND the job text>.
${overrides.domainDirective ? `- Additional directive: ${overrides.domainDirective}` : ''}

Block 2 — Job Task Capsule
- Describe ONLY AI/LLM data work: labeling/training/evaluation activities, label types, modalities, tools/platforms, QA, workflow specifics explicitly present in the job.
- Avoid domain specialties except minimal context when co-mentioned with labeling tasks.
- Exclude generic non-AI duties unless the job explicitly ties them to AI/LLM data work.
- Target 120-200 words (<=220 hard cap).
- End with: Keywords: <10-20 task/tool/label/modality tokens that already appear in the capsule AND the job text>.
${overrides.taskDirective ? `- Additional directive: ${overrides.taskDirective}` : ''}

JOB (verbatim):
${job.promptText}

OUTPUT (exact format):
<Job Domain Capsule paragraph>
Keywords: ...

<Job Task Capsule paragraph>
Keywords: ...`;

  return basePrompt;
}

export function normalizeJobRequest(request: UpsertJobRequest): NormalizedJobPosting {
  const instructions = sanitizeJobField(request.fields?.Instructions);
  const workloadDesc = sanitizeJobField(request.fields?.Workload_Desc);
  const datasetDescription = sanitizeJobField(request.fields?.Dataset_Description);
  const dataSubjectMatter = sanitizeJobField(request.fields?.Data_SubjectMatter);
  const dataType = sanitizeJobField(request.fields?.Data_Type);
  const labelTypes = sanitizeJobStringArray(request.fields?.LabelTypes);
  const requirementsAdditional = sanitizeJobField(request.fields?.Requirements_Additional);
  const availableLanguages = sanitizeJobStringArray(request.fields?.AvailableLanguages);
  const availableCountries = sanitizeJobStringArray(request.fields?.AvailableCountries);
  const expertiseLevel = sanitizeJobField(request.fields?.ExpertiseLevel);
  const timeRequirement = sanitizeJobField(request.fields?.TimeRequirement);
  const projectType = sanitizeJobField(request.fields?.ProjectType);
  const labelSoftware = sanitizeJobField(request.fields?.LabelSoftware);
  const additionalSkills = sanitizeJobStringArray(request.fields?.AdditionalSkills);
  const title = sanitizeJobField(request.title, 500);

  const pairs: Array<[string, string]> = [];
  if (title) pairs.push(['Title', title]);
  if (instructions) pairs.push(['Instructions', instructions]);
  if (workloadDesc) pairs.push(['Workload_Desc', workloadDesc]);
  if (datasetDescription) pairs.push(['Dataset_Description', datasetDescription]);
  if (dataSubjectMatter) pairs.push(['Data_SubjectMatter', dataSubjectMatter]);
  if (dataType) pairs.push(['Data_Type', dataType]);
  if (labelTypes.length > 0) pairs.push(['LabelTypes', labelTypes.join('; ')]);
  if (requirementsAdditional) pairs.push(['Requirements_Additional', requirementsAdditional]);
  if (availableLanguages.length > 0) pairs.push(['AvailableLanguages', availableLanguages.join('; ')]);
  if (availableCountries.length > 0) pairs.push(['AvailableCountries', availableCountries.join('; ')]);
  if (expertiseLevel) pairs.push(['ExpertiseLevel', expertiseLevel]);
  if (timeRequirement) pairs.push(['TimeRequirement', timeRequirement]);
  if (projectType) pairs.push(['ProjectType', projectType]);
  if (labelSoftware) pairs.push(['LabelSoftware', labelSoftware]);
  if (additionalSkills.length > 0) pairs.push(['AdditionalSkills', additionalSkills.join('; ')]);

  assertHasFields(pairs);

  const promptText = formatPairsForPrompt(pairs);
  const sourceText = pairs.map(([, value]) => value).join('\n');

  return {
    jobId: request.job_id,
    title,
    instructions,
    workloadDesc,
    datasetDescription,
    dataSubjectMatter,
    dataType,
    labelTypes,
    requirementsAdditional,
    availableLanguages,
    availableCountries,
    expertiseLevel,
    timeRequirement,
    projectType,
    labelSoftware,
    additionalSkills,
    promptText,
    sourceText,
  };
}

async function requestCapsules(
  job: NormalizedJobPosting,
  overrides: PromptOverrides
): Promise<{ domain: string; task: string }> {
  const client = getOpenAIClient();
  const capsuleModel = resolveCapsuleModel();
  const prompt = buildPrompt(job, overrides);

  const completion = await withRetry(() =>
    client.chat.completions.create({
      model: capsuleModel,
      temperature: CAPSULE_TEMPERATURE,
      messages: [
        { role: 'system', content: JOB_CAPSULE_SYSTEM_MESSAGE },
        { role: 'user', content: prompt },
      ],
    })
  ).catch((error) => {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError({
      code: 'LLM_FAILURE',
      statusCode: 502,
      message: 'Failed to generate job capsules with OpenAI',
      details: { message: (error as Error).message },
    });
  });

  const content = completion.choices?.[0]?.message?.content;
  if (!content) {
    throw new AppError({
      code: 'LLM_FAILURE',
      statusCode: 502,
      message: 'Received empty response from language model when generating job capsules',
    });
  }

  const capsules = extractCapsuleTexts(content);
  return { domain: capsules.domain.text, task: capsules.task.text };
}

export async function generateJobCapsules(job: NormalizedJobPosting): Promise<CapsulePair> {
  let overrides: PromptOverrides = {};

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const capsuleTexts = await requestCapsules(job, overrides);

    const domainValidation = validateJobDomainCapsule(capsuleTexts.domain, job);
    const taskValidation = validateJobTaskCapsule(capsuleTexts.task, job);

    if (domainValidation.needsDomainReprompt && !overrides.domainDirective) {
      logger.warn(
        { event: 'job_capsule.domain_reprompt', jobId: job.jobId },
        'Domain capsule contained AI/LLM terms; requesting rewrite'
      );
      overrides = { ...overrides, domainDirective: 'Remove AI/LLM terms; keep domain nouns only.' };
      continue;
    }

    if (taskValidation.needsTaskReprompt && !overrides.taskDirective) {
      logger.warn(
        { event: 'job_capsule.task_reprompt', jobId: job.jobId },
        'Task capsule contained non-AI duties; requesting rewrite'
      );
      overrides = { ...overrides, taskDirective: 'Remove non-AI duties; keep only AI/LLM labeling/training/eval tasks, tools, labels, modalities, QA.' };
      continue;
    }

    if (domainValidation.needsDomainReprompt || taskValidation.needsTaskReprompt) {
      throw new AppError({
        code: 'LLM_FAILURE',
        statusCode: 502,
        message: 'Failed to generate compliant job capsules after retries',
      });
    }

    return {
      domain: { text: domainValidation.text },
      task: { text: taskValidation.text },
    };
  }

  throw new AppError({
    code: 'LLM_FAILURE',
    statusCode: 502,
    message: 'Exceeded maximum attempts when generating job capsules',
  });
}
