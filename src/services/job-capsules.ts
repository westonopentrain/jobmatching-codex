import { resolveCapsuleModel } from './openai-model';
import { withRetry } from '../utils/retry';
import { AppError } from '../utils/errors';
import { sanitizeJobField, sanitizeJobStringArray } from '../utils/sanitize';
import { CapsulePair, NormalizedJobPosting, UpsertJobRequest } from '../utils/types';
import { createTextResponse } from './openai-responses';

const JOB_CAPSULE_SYSTEM_MESSAGE =
  'You produce two concise, high-precision capsules for vector search from a job posting.\nCapsules must be grammatical sentences only (no bullet lists, no angle brackets, no telegraph style).\nUse facts from the job text; do not invent named employers or tools not mentioned.\nPII-safe: no company names or personal names. Return strictly valid JSON; no extra commentary.';

const CAPSULE_TEMPERATURE = 0.2;
// Allow additional room for the model to satisfy the strict
// formatting + keyword requirements without truncation. The
// previous 800-token cap caused occasional incomplete responses
// from OpenAI ("max_output_tokens").
const CAPSULE_MAX_OUTPUT_TOKENS = 1600;

const KEYWORD_MIN_COUNT = 10;

const DOMAIN_DISALLOWED_TOKENS = [
  'posted',
  'posting',
  'seeking',
  'candidate',
  'candidates',
  'applicant',
  'applicants',
  'availability',
  'schedule',
  'time requirement',
  'hours',
  'budget',
  'rate',
  'pay',
  'countries',
  'language level',
  'labels per file',
  'total labels',
  'number of labelers',
  'opportunity',
  'audience',
  'accuracy',
  'clarity',
  'empathy',
  'content',
  'information',
  'dataset',
  'datasets',
  'file',
  'files',
  'platform',
  'platforms',
  'tool',
  'tools',
  'software',
  'labeling',
  'annotation',
  'evaluate',
  'evaluation',
  'evaluations',
  'rating',
  'ratings',
  'prompt',
  'prompts',
  'response',
  'responses',
  'sft',
  'rlhf',
  'dpo',
  'qa',
];

const TASK_DISALLOWED_TOKENS = [
  'text',
  'dataset',
  'files',
  'labels',
  'labeling software',
  'software',
  'posted',
  'seeking',
  'candidate',
  'candidates',
  'availability',
  'schedule',
  'budget',
  'rate',
  'pay',
  'countries',
  'language level',
  'labels per file',
  'total labels',
  'number of labelers',
];

const DOMAIN_DISALLOWED_SET = new Set(DOMAIN_DISALLOWED_TOKENS.map((token) => token.toLowerCase()));
const TASK_DISALLOWED_SET = new Set(TASK_DISALLOWED_TOKENS.map((token) => token.toLowerCase()));

const KEYWORD_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'into',
  'is',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
  'without',
  'within',
  'across',
  'through',
  'throughout',
  'per',
  'via',
  'using',
  'use',
  'while',
  'when',
  'where',
  'which',
  'that',
  'this',
  'these',
  'those',
  'their',
  'its',
  'will',
  'must',
  'should',
  'can',
  'may',
  'including',
  'include',
  'ensuring',
  'ensure',
  'ensures',
  'providing',
  'provide',
  'requires',
  'require',
  'requirement',
  'requirements',
  'preferred',
  'priority',
  'project',
  'role',
  'candidates',
  'candidate',
  'applicants',
  'applicant',
  'availability',
  'schedule',
  'hours',
]);

const JOB_CAPSULE_USER_MESSAGE = `Return JSON with this exact shape:

{
  "job_id": "<string>",
  "domain_capsule": {
    "text": "<1–2 sentences, 60–110 words, subject-matter ONLY>",
    "keywords": ["<10–16 distinct domain nouns>"]
  },
  "task_capsule": {
    "text": "<1 paragraph, 90–140 words, AI/LLM data work ONLY>",
    "keywords": ["<10–16 distinct task/tool/label/modality/workflow nouns>"]
  }
}

RULES — DOMAIN (subject-matter ONLY)
- Include ONLY subject-matter nouns actually present or canonically implied by the named domain: specialties, subdisciplines, procedures, instruments, standards/frameworks, credentials/licenses (MD, PE, CPA), formal training (residency/fellowship/board), typical settings (clinic, courtroom, plant, field, repo).
- Canonical subareas rule: If the job names a broad domain (e.g., “civil engineering”, “frontend web”, “corporate law”, “accounting”, “data science”), you MAY include well-known subareas and routine procedures commonly and directly subsumed by that domain (e.g., structural analysis, geotechnical design; HTML/CSS/JavaScript/DOM; mergers & acquisitions; financial modeling; supervised learning). Do NOT include niche subtopics that are not standard for the named domain. Limit canonical additions to 5–10 high-signal nouns.
- EXCLUDE: any AI/LLM/data-work terms (annotation, labeling, NER, OCR, bbox, polygon, transcription, prompt, response, SFT, RLHF, DPO, QA), logistics/HR (posted, seeking, candidates, availability, schedule, countries, language level, budget, rate, pay, labels per file, total labels, number of labelers), generic meta (“accuracy”, “clarity”, “empathy”, “audience”, “content”, “information”, “dataset”, “files”), and company names.
- Form: 1–2 sentences, 60–110 words. Prefer concrete nouns over adjectives.
- Keywords: 10–16 distinct domain tokens taken from this domain text. No logistics, no task words, no duplicates.

RULES — TASK (AI/LLM data work ONLY)
- Include ONLY AI/LLM data work explicitly present: label types (evaluation, rating, classification, NER, OCR, transcription), modalities (text, image, audio, video, code), tools/platforms (name only if in job text), workflows (SFT, RLHF, DPO), rubric/QA/consistency checks, prompt/response writing, benchmark/eval dataset creation.
- Keep domain nouns minimal and only when directly tied to a task (e.g., “code annotation”, “legal document classification”, “medical content evaluation”). Do not restate the domain list here.
- EXCLUDE: logistics/HR/marketing/pay/schedule/country/language-level, file counts, “labels per file”, company names. Avoid generic filler tokens like “text/dataset/files/labels” in keywords; prefer precise “text modality” if needed.
- Form: one paragraph, 90–140 words. Do not repeat the same token more than once unless it is a standard acronym (e.g., SFT, RLHF).
- Keywords: 10–16 distinct task/tool/label/modality/workflow tokens from this paragraph. No logistics, no duplicates.

OUTPUT CONSTRAINTS
- Return strictly valid JSON (UTF-8, no trailing commas), exactly matching the schema above.
- Do not include any extra fields.
- Ensure every keyword appears verbatim in the corresponding capsule text. (For DOMAIN keywords, they do not need to appear in JOB_TEXT if they are canonical subareas of the named domain.)

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

function escapeRegExp(token: string): string {
  return token.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function sanitizeCapsuleText(text: string, tokens: string[]): string {
  let sanitized = text;
  for (const token of tokens) {
    const pattern = new RegExp(`(?<!\\S)${escapeRegExp(token)}(?!\\S)`, 'gi');
    sanitized = sanitized.replace(pattern, ' ');
  }

  sanitized = sanitized.replace(/\s{2,}/g, ' ');
  sanitized = sanitized.replace(/\s+([,.;:!?])/g, '$1');
  sanitized = sanitized.replace(/([,.;:!?])(?!\s|$)/g, '$1 ');
  sanitized = sanitized.replace(/\s{2,}/g, ' ').trim();

  if (sanitized.length === 0) {
    return text.trim();
  }

  return sanitized;
}

function extractCandidateTokens(text: string): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
  const regex = /\b[^\s,.;:!?()]+(?:\s+[^\s,.;:!?()]+){0,3}/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const candidate = match[0].trim();
    if (!candidate || candidate.length < 3) {
      continue;
    }

    const normalized = candidate.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }

    const words = normalized.split(/\s+/);
    if (words.every((word) => KEYWORD_STOPWORDS.has(word))) {
      continue;
    }

    results.push(candidate);
    seen.add(normalized);
  }

  return results;
}

function filterKeywords(
  keywords: string[],
  text: string,
  disallowedSet: Set<string>,
  minCount: number
): string[] {
  if (keywords.length === 0) {
    return [];
  }

  if (keywords.length === 1) {
    const [firstKeyword] = keywords;
    if (firstKeyword && firstKeyword.trim().toLowerCase() === 'none') {
      return ['none'];
    }
  }

  const sanitizedKeywords: string[] = [];
  const seen = new Set<string>();

  for (const keyword of keywords) {
    const trimmed = keyword.trim();
    if (!trimmed) {
      continue;
    }

    const normalized = trimmed.toLowerCase();
    if (disallowedSet.has(normalized)) {
      continue;
    }

    if (seen.has(normalized)) {
      continue;
    }

    sanitizedKeywords.push(trimmed);
    seen.add(normalized);
  }

  if (sanitizedKeywords.length >= minCount) {
    return sanitizedKeywords;
  }

  const candidates = extractCandidateTokens(text);
  for (const candidate of candidates) {
    if (sanitizedKeywords.length >= minCount) {
      break;
    }

    const normalized = candidate.toLowerCase();
    if (disallowedSet.has(normalized) || seen.has(normalized)) {
      continue;
    }

    sanitizedKeywords.push(candidate);
    seen.add(normalized);
  }

  return sanitizedKeywords;
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
      maxOutputTokens: CAPSULE_MAX_OUTPUT_TOKENS,
      frequencyPenalty: 0.6,
      presencePenalty: 0,
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

  const domainText = sanitizeCapsuleText(response.domain_capsule.text, DOMAIN_DISALLOWED_TOKENS);
  const domainKeywords = filterKeywords(
    response.domain_capsule.keywords,
    domainText,
    DOMAIN_DISALLOWED_SET,
    KEYWORD_MIN_COUNT
  );

  const taskText = sanitizeCapsuleText(response.task_capsule.text, TASK_DISALLOWED_TOKENS);
  const taskKeywords = filterKeywords(
    response.task_capsule.keywords,
    taskText,
    TASK_DISALLOWED_SET,
    KEYWORD_MIN_COUNT
  );

  return {
    domain: {
      text: domainText,
      keywords: domainKeywords,
    },
    task: {
      text: taskText,
      keywords: taskKeywords,
    },
  };
}
