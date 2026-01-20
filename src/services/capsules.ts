import { NormalizedUserProfile, CapsulePair } from '../utils/types';
import { joinWithLineBreak } from '../utils/sanitize';
import { withRetry } from '../utils/retry';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { validateDomainCapsule, validateSkillsCapsule } from './validate';
import { resolveCapsuleModel } from './openai-model';
import { createTextResponse } from './openai-responses';

const CAPSULE_TEMPERATURE = 0.2;
export const CAPSULE_SYSTEM_MESSAGE =
  'You create profile summaries for freelancer matching using vector similarity. The capsules you output will be embedded and compared against JOB POSTING embeddings. Your job: Output text that would be SEMANTICALLY SIMILAR to job postings seeking this candidate. Capture ALL relevant skills and experience - jobs vary widely (medical writing, data labeling, translation, research, etc.). Be PII-safe: do not include names or contact details.';

export function buildCapsulePrompt(profile: NormalizedUserProfile): string {
  const workExperience = joinWithLineBreak(profile.workExperience);
  const education = joinWithLineBreak(profile.education);
  const labelingExperience = joinWithLineBreak(profile.labelingExperience);
  const languages = joinWithLineBreak(profile.languages);
  const country = profile.country ?? 'Unknown';

  return `Write TWO capsules that will be embedded and matched against JOB POSTING embeddings.

CRITICAL CONTEXT: This is for a freelancer marketplace. Jobs vary widely: AI data labeling, medical writing, translation, research, teaching, content creation, etc.
Your output must be SEMANTICALLY SIMILAR to what job postings say when seeking this type of candidate.

## DOMAIN CAPSULE (WHO is this person? 5-20 words)

This represents their PROFESSIONAL IDENTITY - who they are in their career.
Think: What would they put as their job title on LinkedIn?

PRIORITY: Base this on WORK EXPERIENCE and EDUCATION, NOT labeling experience.
A marketing professional who does data labeling = "Marketing specialist", NOT "Data annotator".

Ask yourself these questions IN ORDER. Stop at the FIRST YES:

1. Does this person have a LICENSED/CREDENTIALED PROFESSION (doctor, lawyer, accountant, nurse, pharmacist, engineer with PE)?
   → Output: "[Profession title]. [Specialty/domain]."
   → Example: "OBGYN physician. Obstetrics and gynecology medical expertise."

2. Is this person's PRIMARY PROFESSION language-related (translator, interpreter, localization specialist)?
   → Only match if their MAIN JOB is translation, interpretation, or language services
   → Do NOT match: software engineers, data scientists, etc. who happen to speak a language natively
   → Output: "[Language] translator/interpreter. [Language services expertise]."
   → Example: "Swedish translator. Translation, localization, and subtitling expertise."

3. Does this person work with a SPECIFIC TECH FRAMEWORK/LANGUAGE as their PRIMARY skill?
   Look for: Angular, React, Vue, .NET, Java, Python, Node.js, iOS, Android, etc.
   → Output: "[Framework/Language] developer. [Related technologies]."
   → Examples:
     - "Angular developer. JavaScript, TypeScript, frontend engineering."
     - "React developer. TypeScript, Next.js, frontend development."
     - ".NET developer. C#, ASP.NET Core, backend services."
     - "Python developer. Django, FastAPI, data engineering."
   → IMPORTANT: Use the SPECIFIC framework, not generic "Software engineer"

4. Does this person have other TECHNICAL SKILLS (data science, DevOps, design)?
   → Output: "[Specific role]. [Domain/tools]."
   → Example: "Data scientist. Machine learning, Python, statistical modeling."

5. If none of the above apply, examine their WORK EXPERIENCE and EDUCATION to identify their professional identity:

   Think through: What is this person's PRIMARY profession based on their career history?
   - Look at job titles, industries, and skills from their work history
   - Consider their education and any specialized training
   - Identify what makes them unique professionally

   Output: "[Their profession/expertise]. [Key skills or domain]."

   Examples of the VARIETY of professions you might identify:
   - "Marketing specialist. Digital marketing, social media campaigns, SEO."
   - "Artist. Illustration, digital art, concept design."
   - "Poet and creative writer. Poetry, literary fiction, creative workshops."
   - "Opera singer. Classical vocal performance, music education."
   - "Medical assistant. Patient intake, clinical support, EKG procedures."
   - "Customer service professional. Call center, CRM, client relations."
   - "Retail manager. Store operations, inventory, team leadership."
   - "Chef. Culinary arts, menu development, kitchen management."
   - "Photographer. Portrait photography, event coverage, photo editing."
   - "Life coach. Personal development, career counseling."
   - "Teacher. K-12 education, curriculum development, classroom instruction."
   - "Accountant. Bookkeeping, tax preparation, financial reporting."

   IMPORTANT:
   - Every person has SOMETHING that defines their professional identity
   - Do NOT default to labeling/annotation unless that's genuinely their ONLY work experience
   - Labeling/AI Experience is for the SKILLS CAPSULE, not domain

6. ONLY if there is genuinely NO work experience, education, or professional background whatsoever:
   → Output: "General workforce. No specialized expertise documented."

RULES:
- Use ONLY facts explicitly stated in SOURCE. Do NOT infer or embellish.
- Do NOT include: AI/LLM terms, dates, employers, years of experience, soft skills.
- Output MUST be 5-20 words total (not counting keywords).
- End with: Keywords: <3-8 key domain nouns>

## SKILLS CAPSULE (WHAT can this person do? 10-30 words)

Summarize this person's professional skills and task experience based on their work history:
- What types of work have they done? (writing, editing, labeling, research, teaching, translation, annotation, etc.)
- What tools/platforms have they used?
- What deliverables have they produced?

Output format: "[Primary skill type]. [Specific skills and experience details]."

Examples:
- "Medical writing and editorial review. BMJ content editing, e-learning module development, exam question creation, clinical guideline writing."
- "Data annotation and labeling. Image classification, NER, bounding boxes using Scale AI and Labelbox, RLHF preference ranking."
- "Translation and localization. Subtitling, audiovisual translation, quality assurance for broadcast media, transcription."
- "Software development and code review. Python backend development, API design, code annotation, technical documentation."

RULES:
- Capture ALL professional skills mentioned in SOURCE, not just AI/labeling experience.
- Be specific about tools, platforms, and deliverables when mentioned.
- Output MUST be 10-30 words total (not counting keywords).
- End with: Keywords: <5-10 skill-related nouns>

SOURCE (verbatim):
- Resume Text:
${profile.resumeText}
- Work Experience:
${workExperience}
- Education:
${education}
- Labeling/AI Experience:
${labelingExperience}
- Languages/Country:
${languages}, ${country}

OUTPUT FORMAT:
<Domain Capsule text here>
Keywords: ...

<Skills Capsule text here>
Keywords: ...`;
}

export function extractCapsuleTexts(raw: string): CapsulePair {
  const trimmed = raw.trim();
  const capsuleRegex = /([\s\S]+?Keywords:[^\n]*)(?:\n{2,}|$)/g;
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = capsuleRegex.exec(trimmed)) !== null) {
    const segment = match[1];
    if (segment) {
      matches.push(segment.trim());
    }
    if (matches.length === 2) {
      break;
    }
  }

  if (matches.length !== 2) {
    throw new AppError({
      code: 'LLM_FAILURE',
      statusCode: 502,
      message: 'Unable to parse capsule response from language model',
      details: { snippet: trimmed.slice(0, 200) },
    });
  }

  for (const capsule of matches) {
    if (!/Keywords:\s*.+/i.test(capsule)) {
      throw new AppError({
        code: 'LLM_FAILURE',
        statusCode: 502,
        message: 'Capsule is missing a Keywords line',
        details: { capsule },
      });
    }
  }

  const [domain, task] = matches as [string, string];

  return {
    domain: { text: domain },
    task: { text: task },
  };
}

export async function generateCapsules(profile: NormalizedUserProfile): Promise<CapsulePair> {
  const prompt = buildCapsulePrompt(profile);
  const capsuleModel = resolveCapsuleModel();

  const responseText = await withRetry(() =>
    createTextResponse({
      model: capsuleModel,
      messages: [
        { role: 'system', content: CAPSULE_SYSTEM_MESSAGE },
        { role: 'user', content: prompt },
      ],
      temperature: CAPSULE_TEMPERATURE,
      frequencyPenalty: 0.6,
      presencePenalty: 0,
    })
  ).catch((error) => {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError({
      code: 'LLM_FAILURE',
      statusCode: 502,
      message: 'Failed to generate capsules with OpenAI',
      details: { message: (error as Error).message },
    });
  });

  if (!responseText) {
    throw new AppError({
      code: 'LLM_FAILURE',
      statusCode: 502,
      message: 'Received empty response from language model',
    });
  }

  const capsules = extractCapsuleTexts(responseText);

  const domainValidation = await validateDomainCapsule(capsules.domain.text);
  // Skills capsule validation - just check format, don't enforce evidence
  const skillsValidation = validateSkillsCapsule(capsules.task.text);
  if (skillsValidation.violations.length > 0) {
    logger.warn(
      {
        event: 'capsules.validation',
        userId: profile.userId,
        violations: skillsValidation.violations,
      },
      'Skills capsule has validation issues'
    );
  }

  return {
    domain: { text: domainValidation.revised },
    task: { text: skillsValidation.text },
  };
}
