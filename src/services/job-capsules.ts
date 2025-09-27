import { resolveCapsuleModel } from './openai-model';
import { extractCapsuleTexts } from './capsules';
import { withRetry } from '../utils/retry';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { sanitizeJobField, sanitizeJobStringArray } from '../utils/sanitize';
import { CapsulePair, NormalizedJobPosting, UpsertJobRequest } from '../utils/types';
import { extractLabelingEvidence, LabelingEvidenceResult } from '../utils/evidence';
import { extractDomainEvidence, DomainEvidence } from '../utils/evidence_domain';
import {
  validateDomainCapsuleText,
  validateTaskCapsuleText,
} from './validate_job_capsules';
import { createTextResponse } from './openai-responses';

const JOB_CAPSULE_SYSTEM_MESSAGE =
  'You generate Job Domain and Task capsules for vector search across ANY domain. Be PII-safe. Do not include names. Output sentences only (no angle brackets, no bullets).';

const CAPSULE_TEMPERATURE = 0.2;
const MAX_GENERATION_ATTEMPTS = 3;

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

function combineEvidenceTerms(evidence: DomainEvidence | LabelingEvidenceResult): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const list of [evidence.phrases, evidence.tokens]) {
    for (const term of list) {
      const trimmed = term.trim();
      if (!trimmed) {
        continue;
      }
      const key = trimmed.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      ordered.push(trimmed);
    }
  }

  return ordered;
}

function formatEvidenceBlock(terms: string[]): string {
  if (terms.length === 0) {
    return '(none)';
  }
  return terms.join(', ');
}

function buildDomainEvidenceSource(job: NormalizedJobPosting): string {
  const segments: string[] = [];
  if (job.title) segments.push(job.title);
  if (job.instructions) segments.push(job.instructions);
  if (job.datasetDescription) segments.push(job.datasetDescription);
  if (job.dataSubjectMatter) segments.push(job.dataSubjectMatter);
  if (job.dataType) segments.push(job.dataType);
  if (job.requirementsAdditional) segments.push(job.requirementsAdditional);
  if (job.additionalSkills.length > 0) segments.push(job.additionalSkills.join('\n'));
  return segments
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join('\n');
}

function buildPrompt(
  job: NormalizedJobPosting,
  domainEvidence: DomainEvidence,
  taskEvidence: LabelingEvidenceResult
): string {
  const domainTerms = combineEvidenceTerms(domainEvidence);
  const taskTerms = combineEvidenceTerms(taskEvidence);

  return `You must produce EXACTLY two blocks in this order.

Block 1 — Job Domain Capsule (domain-only, evidence-constrained)
- Use ONLY tokens from DOMAIN_EVIDENCE (or obvious standard synonyms of those exact tokens).
- Produce 1–2 concise sentences (no angle brackets, no lists). Noun-dense; avoid roles, narratives, logistics, or soft skills.
- DO NOT include AI/LLM labeling/training/evaluation terms, tools, or QA.
- Target 80–160 words (<=200 hard cap).
- End with: Keywords: <10–20 tokens chosen ONLY from DOMAIN_EVIDENCE and present in this paragraph>.

Block 2 — Job Task Capsule (AI/LLM work only, evidence-constrained)
- Use ONLY tokens from TASK_EVIDENCE (or obvious standard synonyms of those exact tokens).
- Describe labeling/training/evaluation activities, label types, modalities, tools/platforms, workflows (SFT, RLHF, DPO) explicitly present in the job.
- EXCLUDE logistics/hiring/budget/schedule/country/language requirements unless explicitly part of the labeling task (e.g., “Spanish transcription”).
- 120–200 words (<=220 hard cap).
- End with: Keywords: <10–20 tokens chosen ONLY from TASK_EVIDENCE and present in this paragraph>.

Do not use angle brackets < >. Do not output bullet lists.

JOB (verbatim):
${job.promptText}

DOMAIN_EVIDENCE (allowed tokens/phrases for Block 1 only):
${formatEvidenceBlock(domainTerms)}

TASK_EVIDENCE (allowed tokens/phrases for Block 2 only):
${formatEvidenceBlock(taskTerms)}

FORMAT:
<Job Domain Capsule paragraph>
Keywords: ...

<Job Task Capsule paragraph>
Keywords: ...`;
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

async function requestCapsules(job: NormalizedJobPosting, prompt: string): Promise<{ domain: string; task: string }> {
  const capsuleModel = resolveCapsuleModel();

  const responseText = await withRetry(() =>
    createTextResponse({
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

  if (!responseText) {
    throw new AppError({
      code: 'LLM_FAILURE',
      statusCode: 502,
      message: 'Received empty response from language model when generating job capsules',
    });
  }

  const capsules = extractCapsuleTexts(responseText);
  return { domain: capsules.domain.text, task: capsules.task.text };
}

export async function generateJobCapsules(job: NormalizedJobPosting): Promise<CapsulePair> {
  const domainEvidenceSource = buildDomainEvidenceSource(job);
  const domainEvidence = extractDomainEvidence(domainEvidenceSource);
  const taskEvidence = extractLabelingEvidence(job.sourceText);
  const prompt = buildPrompt(job, domainEvidence, taskEvidence);

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const capsuleTexts = await requestCapsules(job, prompt);

    try {
      const domainText = await validateDomainCapsuleText(capsuleTexts.domain, {
        evidence: domainEvidence,
      });
      const taskText = await validateTaskCapsuleText(capsuleTexts.task, {
        evidence: taskEvidence,
      });

      return {
        domain: { text: domainText },
        task: { text: taskText },
      };
    } catch (error) {
      if (attempt === MAX_GENERATION_ATTEMPTS - 1) {
        throw error;
      }
      logger.warn(
        {
          event: 'job_capsule.validation_retry',
          jobId: job.jobId,
          attempt: attempt + 1,
          message: (error as Error).message,
        },
        'Retrying job capsule generation due to validation failure'
      );
    }
  }

  throw new AppError({
    code: 'LLM_FAILURE',
    statusCode: 502,
    message: 'Exceeded maximum attempts when generating job capsules',
  });
}
