import { resolveCapsuleModel } from './openai-model';
import { withRetry } from '../utils/retry';
import { AppError } from '../utils/errors';
import { sanitizeJobField, sanitizeJobStringArray } from '../utils/sanitize';
import { CapsulePair, NormalizedJobPosting, UpsertJobRequest } from '../utils/types';
import { createTextResponse } from './openai-responses';

const JOB_CAPSULE_SYSTEM_MESSAGE =
  'You produce two concise, high-precision capsules for vector search from a job posting. \nCapsules must be grammatical sentences (no bullet lists, no angle brackets, no telegraph style).\nYou must output only valid JSON following the given schema; do not include commentary or explanation. \nUse only facts present in the job text. Do not invent.\nBe PII-safe: do not include company names or personal names.';

const CAPSULE_TEMPERATURE = 0.2;

const JOB_CAPSULE_USER_MESSAGE = `You must return JSON with this exact schema:

{
  "job_id": "<string>",
  "domain_capsule": {
    "text": "<1–2 sentences, 60–120 words, subject-matter ONLY>",
    "keywords": ["<10–16 distinct domain nouns>"]
  },
  "task_capsule": {
    "text": "<1 paragraph, 80–140 words, AI/LLM data work ONLY>",
    "keywords": ["<10–16 distinct task/tool/label/modality/workflow nouns>"]
  }
}

DEFINITIONS & RULES

GENERAL
- Use ONLY facts in JOB_TEXT. Do not invent tools, tasks, or domains.
- Sentences only (no lists, no angle brackets, no headings).
- Avoid generic filler: do not include “posted”, “seeking”, “candidates”, “opportunity”, “flexible schedule”, “availability”, “budget”, “rate”, “pay”, “hours”, “countries”, “English level”, “labels per file”, “total labels”, “number of labelers”, or company names (e.g., remove “OpenTrain”).
- Keywords must be distinct noun or noun-phrase tokens that appear verbatim in BOTH (a) the capsule text and (b) JOB_TEXT. 
- Do not include numbers, months, or vague meta words in keywords (e.g., avoid “five”, “minimum”, “accuracy”, “clarity”, “audience”, “resource”, “reliability”, “accessibility”).
- Lowercase keywords unless they are standard acronyms or proper domain abbreviations (e.g., “OB‑GYN”, “MD”, “SFT”, “RLHF”).

DOMAIN CAPSULE (subject-matter ONLY)
- Purpose: encode the job’s hard subject-matter requirements so specialists cluster together.
- Include ONLY subject-matter nouns actually present in JOB_TEXT: specialties, subdisciplines, procedures, instruments, imaging modalities, credentials/licenses (e.g., MD, board-certified), formal training (residency/fellowship), standards/frameworks, domain-specific data types.
- EXCLUDE: AI/LLM annotation terms (annotation, labeling, NER, OCR, bbox, polygon, transcription, prompt, SFT, RLHF, DPO, “Label Studio”, “CVAT”), hiring/marketing/logistics/pay/schedule/country/language level, soft-skill meta (accuracy, clarity, empathy).
- Form: 1–2 sentences, 60–120 words. 
- Keywords: 10–16 distinct domain tokens drawn from the domain sentences (e.g., “obstetrics and gynecology”, “maternal‑fetal medicine”, “obstetric ultrasound”, “gynecologic surgery”, “labor and delivery”, “MD”, “residency”, “women’s health”). No duplicates; no junk.

TASK CAPSULE (AI/LLM data work ONLY)
- Purpose: encode the job’s labeling/training/evaluation work so skills matchers retrieve the right people.
- Include ONLY AI/LLM data work explicitly present in JOB_TEXT: label types (evaluation, rating, classification, NER, OCR, transcription), modalities (text, image, audio, video, code), tools/platforms (name only if present), workflows (SFT, RLHF, DPO), rubric/QA/consistency checks, prompt/response writing, benchmark/eval dataset creation.
- Keep domain nouns minimal and only when directly tied to a task (e.g., “medical content evaluation”). 
- EXCLUDE: hiring/marketing/logistics/pay/schedule/country/language level, headcount, file counts, “labels per file”, company names.
- Form: 1 paragraph, 80–140 words. Do not repeat the same token more than once unless it is part of a standard acronym or necessary noun phrase.
- Keywords: 10–16 distinct task/tool/label/modality/workflow tokens drawn from the task paragraph (e.g., “evaluation”, “rating”, “rubric”, “prompt writing”, “response writing”, “supervised fine‑tuning”, “SFT”, “text modality”, “annotation QA”). No duplicates; no junk.

IF NO TASK EVIDENCE
- If JOB_TEXT contains no explicit AI/LLM labeling/training/evaluation details, set:
  task_capsule.text = "No AI/LLM data-labeling, model training, or evaluation requirements are stated in this job."
  task_capsule.keywords = ["none"]

OUTPUT CONSTRAINTS
- Output strictly valid JSON (UTF-8, no trailing commas).
- Do not include any fields other than the schema above.
- Ensure every keyword appears verbatim in both the capsule text and JOB_TEXT (except “none” case).

JOB_TITLE: {{JOB_TITLE}}
JOB_TEXT:
{{JOB_TEXT}}

job_id for output: {{JOB_ID}}`;

interface CapsuleSection {
  text: string;
  keywords: string[];
}

interface JobCapsuleModelResponse {
  job_id: string;
  domain_capsule: CapsuleSection;
  task_capsule: CapsuleSection;
}

class CapsuleResponseError extends Error {
  public readonly retryable: boolean;

  constructor(message: string, retryable = true) {
    super(message);
    this.name = 'CapsuleResponseError';
    this.retryable = retryable;
  }
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

function fillTemplate(template: string, replacements: Record<string, string>): string {
  let output = template;
  for (const [key, value] of Object.entries(replacements)) {
    const token = `{{${key}}}`;
    output = output.split(token).join(value);
  }
  return output;
}

function buildUserPrompt(job: NormalizedJobPosting): string {
  const jobTitle = job.title ?? '';
  const replacements = {
    JOB_TITLE: jobTitle,
    JOB_TEXT: job.sourceText,
    JOB_ID: job.jobId,
  };

  return fillTemplate(JOB_CAPSULE_USER_MESSAGE, replacements);
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

function ensureSection(section: unknown, field: 'domain_capsule' | 'task_capsule'): CapsuleSection {
  if (!section || typeof section !== 'object') {
    throw new CapsuleResponseError(`${field} field is missing or invalid`);
  }

  const maybeSection = section as Partial<CapsuleSection>;
  if (typeof maybeSection.text !== 'string') {
    throw new CapsuleResponseError(`${field} text is missing or invalid`);
  }

  const text = maybeSection.text.trim();
  if (!text) {
    throw new CapsuleResponseError(`${field} text is empty`);
  }

  if (!Array.isArray(maybeSection.keywords) || maybeSection.keywords.length === 0) {
    throw new CapsuleResponseError(`${field} keywords are missing`);
  }

  const keywords: string[] = [];
  for (const keyword of maybeSection.keywords) {
    if (typeof keyword !== 'string') {
      throw new CapsuleResponseError(`${field} keywords must be strings`);
    }
    const trimmed = keyword.trim();
    if (!trimmed) {
      throw new CapsuleResponseError(`${field} keywords must be non-empty strings`);
    }
    keywords.push(trimmed);
  }

  return { text, keywords };
}

function parseJobCapsuleResponse(raw: string): JobCapsuleModelResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new CapsuleResponseError(`Unable to parse JSON response: ${(error as Error).message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new CapsuleResponseError('Capsule response is not an object');
  }

  const jobResponse = parsed as Partial<JobCapsuleModelResponse>;
  if (!jobResponse.job_id || typeof jobResponse.job_id !== 'string') {
    throw new CapsuleResponseError('job_id field is missing or invalid');
  }

  const domain_capsule = ensureSection(jobResponse.domain_capsule, 'domain_capsule');
  const task_capsule = ensureSection(jobResponse.task_capsule, 'task_capsule');

  return {
    job_id: jobResponse.job_id,
    domain_capsule,
    task_capsule,
  };
}

async function callJobCapsuleModel(userPrompt: string): Promise<string> {
  const capsuleModel = resolveCapsuleModel();

  const responseText = await withRetry(() =>
    createTextResponse({
      model: capsuleModel,
      temperature: CAPSULE_TEMPERATURE,
      messages: [
        { role: 'system', content: JOB_CAPSULE_SYSTEM_MESSAGE },
        { role: 'user', content: userPrompt },
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

  return responseText;
}

async function requestCapsules(job: NormalizedJobPosting): Promise<JobCapsuleModelResponse> {
  const userPrompt = buildUserPrompt(job);
  let lastError: Error | null = null;
  let lastResponse: string | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const responseText = await callJobCapsuleModel(userPrompt);
    lastResponse = responseText;

    try {
      const parsed = parseJobCapsuleResponse(responseText);
      if (parsed.job_id !== job.jobId) {
        throw new CapsuleResponseError('Returned job_id does not match request job_id');
      }
      return parsed;
    } catch (error) {
      lastError = error as Error;
      if (error instanceof CapsuleResponseError && error.retryable && attempt === 0) {
        continue;
      }
      break;
    }
  }

  throw new AppError({
    code: 'LLM_FAILURE',
    statusCode: 502,
    message: 'Failed to parse job capsule response from language model',
    details: {
      error: lastError ? lastError.message : 'unknown error',
      snippet: lastResponse ? lastResponse.slice(0, 200) : undefined,
    },
  });
}

export async function generateJobCapsules(job: NormalizedJobPosting): Promise<CapsulePair> {
  const response = await requestCapsules(job);

  return {
    domain: {
      text: response.domain_capsule.text,
      keywords: response.domain_capsule.keywords,
    },
    task: {
      text: response.task_capsule.text,
      keywords: response.task_capsule.keywords,
    },
  };
}
