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

function mergeDirective(
  current: string | undefined,
  addition: string
): { text: string | undefined; changed: boolean } {
  if (!addition.trim()) {
    return { text: current, changed: false };
  }
  if (!current) {
    return { text: addition, changed: true };
  }
  if (current.includes(addition)) {
    return { text: current, changed: false };
  }
  return { text: `${current} ${addition}`.trim(), changed: true };
}

const DOMAIN_KEYWORD_DIRECTIVE =
  'Ensure Keywords line only repeats tokens that appear verbatim in the domain capsule paragraph and provided job fields.';
const TASK_KEYWORD_DIRECTIVE =
  'Ensure Keywords line only repeats tokens that appear verbatim in the task capsule paragraph and provided job fields.';
const DOMAIN_AI_DIRECTIVE = 'Remove AI/LLM terms; keep domain nouns only.';
const TASK_AI_DIRECTIVE =
  'Remove non-AI duties; keep only AI/LLM labeling/training/eval tasks, tools, labels, modalities, QA.';

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

  const normalized: NormalizedJobPosting = {
    jobId: request.job_id,
    labelTypes,
    availableLanguages,
    availableCountries,
    additionalSkills,
    promptText,
    sourceText,
  };

  if (title !== undefined) normalized.title = title;
  if (instructions !== undefined) normalized.instructions = instructions;
  if (workloadDesc !== undefined) normalized.workloadDesc = workloadDesc;
  if (datasetDescription !== undefined) normalized.datasetDescription = datasetDescription;
  if (dataSubjectMatter !== undefined) normalized.dataSubjectMatter = dataSubjectMatter;
  if (dataType !== undefined) normalized.dataType = dataType;
  if (requirementsAdditional !== undefined) normalized.requirementsAdditional = requirementsAdditional;
  if (expertiseLevel !== undefined) normalized.expertiseLevel = expertiseLevel;
  if (timeRequirement !== undefined) normalized.timeRequirement = timeRequirement;
  if (projectType !== undefined) normalized.projectType = projectType;
  if (labelSoftware !== undefined) normalized.labelSoftware = labelSoftware;

  return normalized;
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

    let domainValidation;
    let taskValidation;

    try {
      domainValidation = validateJobDomainCapsule(capsuleTexts.domain, job);
      taskValidation = validateJobTaskCapsule(capsuleTexts.task, job);
    } catch (error) {
      if (
        error instanceof AppError &&
        error.message === 'Capsule keywords must appear in both capsule text and job fields'
      ) {
        const context = error.details?.context as 'domain' | 'task' | undefined;
        if (context === 'domain') {
          const { text, changed } = mergeDirective(overrides.domainDirective, DOMAIN_KEYWORD_DIRECTIVE);
          if (changed) {
            logger.warn(
              {
                event: 'job_capsule.domain_keyword_reprompt',
                jobId: job.jobId,
                missing: error.details?.missing,
              },
              'Domain capsule keywords missing from capsule or job text; requesting rewrite'
            );
            overrides = { ...overrides, domainDirective: text };
            continue;
          }
        } else if (context === 'task') {
          const { text, changed } = mergeDirective(overrides.taskDirective, TASK_KEYWORD_DIRECTIVE);
          if (changed) {
            logger.warn(
              {
                event: 'job_capsule.task_keyword_reprompt',
                jobId: job.jobId,
                missing: error.details?.missing,
              },
              'Task capsule keywords missing from capsule or job text; requesting rewrite'
            );
            overrides = { ...overrides, taskDirective: text };
            continue;
          }
        }
      }
      throw error;
    }

    if (domainValidation.needsDomainReprompt) {
      const { text, changed } = mergeDirective(overrides.domainDirective, DOMAIN_AI_DIRECTIVE);
      if (changed) {
        overrides = { ...overrides, domainDirective: text };
        logger.warn(
          { event: 'job_capsule.domain_reprompt', jobId: job.jobId },
          'Domain capsule contained AI/LLM terms; requesting rewrite'
        );
        continue;
      }
    }

    if (taskValidation.needsTaskReprompt) {
      const { text, changed } = mergeDirective(overrides.taskDirective, TASK_AI_DIRECTIVE);
      if (changed) {
        overrides = { ...overrides, taskDirective: text };
        logger.warn(
          { event: 'job_capsule.task_reprompt', jobId: job.jobId },
          'Task capsule contained non-AI duties; requesting rewrite'
        );
        continue;
      }
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
