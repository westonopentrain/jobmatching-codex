import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateCapsules, CAPSULE_SYSTEM_MESSAGE, buildCapsulePrompt } from '../src/services/capsules';
import { NormalizedUserProfile } from '../src/utils/types';
import { NO_EVIDENCE_TASK_CAPSULE, validateTaskCapsule } from '../src/services/validate';
import { extractLabelingEvidence } from '../src/utils/evidence';

interface MockResponse {
  content: string;
  assert?: (payload: any) => void;
}

const mockResponses: MockResponse[] = [];

const mockCreate = vi.fn(async (payload: any) => {
  const response = mockResponses.shift();
  if (!response) {
    throw new Error('No mock response queued for OpenAI client');
  }
  if (response.assert) {
    response.assert(payload);
  }
  return {
    output_text: response.content,
  };
});

vi.mock('../src/services/openai-client', () => ({
  getOpenAIClient: () => ({
    responses: {
      create: mockCreate,
    },
  }),
}));

function createProfile(overrides: Partial<NormalizedUserProfile>): NormalizedUserProfile {
  return {
    userId: 'test-user',
    resumeText: 'Placeholder resume text.',
    workExperience: [],
    education: [],
    labelingExperience: [],
    languages: [],
    ...overrides,
  };
}

describe('validateTaskCapsule', () => {
  it('allows QA sentences paired with annotation evidence', () => {
    const taskParagraph =
      'The candidate leads QA reviews of annotation workflows with senior annotators overseeing label quality.\nKeywords: annotation, qa';
    const result = validateTaskCapsule(taskParagraph, new Set(['annotation', 'qa']));

    expect(result.text).toBe(taskParagraph);
    expect(result.violations).toEqual([]);
  });
});

describe('capsule prompt', () => {
  it('includes strict rules and evidence list for downstream generation', () => {
    const profile = createProfile({
      resumeText: 'Frontend engineer working with React and TypeScript.',
      workExperience: ['Built UI components for logistics dashboards.'],
      labelingExperience: ['Prompt writing and response evaluation for RLHF.'],
      languages: ['English'],
      country: 'US',
    });
    const evidenceSource = [
      profile.resumeText,
      ...profile.workExperience,
      ...profile.labelingExperience,
      profile.languages[0],
      profile.country ?? '',
    ].join('\n');
    const evidence = extractLabelingEvidence(evidenceSource);
    const prompt = buildCapsulePrompt(profile, evidence);

    expect(prompt).toContain('GLOBAL RULES');
    expect(prompt).toContain('Profile Domain Capsule (subject-matter ONLY; 90-140 words)');
    expect(prompt).toContain('Profile Task Capsule (AI/LLM data work ONLY; evidence-only; 0 or 120-200 words)');
    expect(prompt).toContain("EVIDENCE (use ONLY these for the Task Capsule when non-empty; if empty, use the fixed line above):");
    expect(prompt).toContain('prompt writing');
    expect(prompt).toContain('No AI/LLM data-labeling, model training, or evaluation experience was provided in the source.');
  });
});

describe('generateCapsules integration', () => {
  beforeEach(() => {
    mockResponses.length = 0;
    mockCreate.mockClear();
  });

  it('generates domain capsules across multiple domains without AI leakage', async () => {
    const profiles: Array<{ profile: NormalizedUserProfile; noun: string; domainText: string }> = [
      {
        profile: createProfile({
          userId: 'med',
          resumeText: 'The candidate is an obstetrics specialist focused on maternal-fetal medicine.',
          workExperience: ['OB hospitalist managing labor and delivery triage.'],
          education: ['MD in obstetrics and gynecology.'],
        }),
        noun: 'maternal-fetal medicine',
        domainText:
          'Obstetrics, maternal-fetal medicine, prenatal diagnostics, cesarean delivery planning, postpartum recovery pathways, neonatal care coordination, high-risk pregnancy management, fetal monitoring protocols, obstetric triage standards, perinatal imaging reviews.\nKeywords: obstetrics, maternal-fetal medicine, prenatal diagnostics, cesarean delivery planning, postpartum recovery pathways, neonatal care coordination, high-risk pregnancy management, fetal monitoring protocols, obstetric triage standards, perinatal imaging reviews',
      },
      {
        profile: createProfile({
          userId: 'dev',
          resumeText: 'Full-stack engineer shipping TypeScript APIs and React frontends.',
          workExperience: ['Designed CI/CD for Node.js microservices.'],
          education: ['BS Computer Science with distributed systems focus.'],
        }),
        noun: 'TypeScript',
        domainText:
          'TypeScript services, React interfaces, API architecture, CI/CD automation, distributed systems observability, Node.js microservices, frontend frameworks, web performance optimization, design systems, cloud deployment pipelines.\nKeywords: TypeScript services, React interfaces, API architecture, CI/CD automation, distributed systems observability, Node.js microservices, frontend frameworks, web performance optimization, design systems, cloud deployment pipelines',
      },
      {
        profile: createProfile({
          userId: 'writer',
          resumeText: 'Editorial lead for literary nonfiction and cultural reporting.',
          workExperience: ['Edited longform essays and magazine features.'],
          education: ['BA in English literature.'],
        }),
        noun: 'nonfiction',
        domainText:
          'Literary nonfiction, cultural reporting, longform essays, magazine features, narrative structure, editorial strategy, copyediting standards, fact-checking protocols, publication workflows, style guides.\nKeywords: literary nonfiction, cultural reporting, longform essays, magazine features, narrative structure, editorial strategy, copyediting standards, fact-checking protocols, publication workflows, style guides',
      },
      {
        profile: createProfile({
          userId: 'finance',
          resumeText: 'Chartered financial analyst advising on fixed-income portfolios.',
          workExperience: ['Managed municipal bond ladders and credit analysis.'],
          education: ['MBA in finance and risk management.'],
        }),
        noun: 'fixed-income',
        domainText:
          'Fixed-income strategy, municipal bonds, credit analysis, duration hedging, institutional mandates, portfolio optimization, risk management frameworks, derivatives evaluation, compliance standards, financial modeling.\nKeywords: Fixed-income strategy, municipal bonds, credit analysis, duration hedging, institutional mandates, portfolio optimization, risk management frameworks, derivatives evaluation, compliance standards, financial modeling',
      },
    ];

    for (const { domainText } of profiles) {
      mockResponses.push({
        content: `${domainText}\n\n${NO_EVIDENCE_TASK_CAPSULE}`,
        assert: (payload) => {
          expect(payload.input[0].content).toBe(CAPSULE_SYSTEM_MESSAGE);
        },
      });
    }

    for (const { profile, noun } of profiles) {
      const capsules = await generateCapsules(profile);
      expect(capsules.domain.text.toLowerCase()).toContain(noun.toLowerCase());
      expect(capsules.domain.text.toLowerCase()).not.toContain('annotation');
      expect(capsules.task.text).toBe(NO_EVIDENCE_TASK_CAPSULE);
      expect(capsules.domain.text).toMatch(/Keywords:/);
      expect(capsules.domain.text.split('\n')[0].length).toBeGreaterThan(0);
    }
  });

  it('forces fixed sentence when LLM outputs task content without evidence', async () => {
    mockResponses.push({
      content:
        'Domain capsule text about healthcare revenue cycle.\nKeywords: healthcare, revenue cycle\n\nPerformed analytics and documentation for reporting.\nKeywords: analytics, documentation',
    });

    const profile = createProfile({
      resumeText: 'Healthcare operations manager overseeing surgical schedules.',
      workExperience: ['Coordinated perioperative staffing.'],
      education: ['MBA Healthcare Management.'],
    });

    const capsules = await generateCapsules(profile);
    expect(capsules.task.text).toBe(NO_EVIDENCE_TASK_CAPSULE);
  });

  it('preserves valid task capsule for code annotation evidence', async () => {
    const taskParagraph =
      'The candidate leads UI screenshot annotation with bounding boxes in Label Studio, delivering HTML/CSS/JS interface tagging, code diff classification, and prompt writing for SFT response libraries.\nKeywords: bounding box, label studio, html/css/js code, prompt writing, sft';

    mockResponses.push({
      content: `Domain capsule for frontend tooling.\nKeywords: frontend, tooling\n\n${taskParagraph}`,
    });

    const profile = createProfile({
      resumeText: 'Frontend engineer working on design systems.',
      workExperience: ['Implemented component libraries.'],
      labelingExperience: [
        'UI screenshot annotation with bounding boxes using Label Studio; HTML/CSS/JS code diff classification; prompt writing for SFT.',
      ],
      languages: ['German', 'English'],
      country: 'DE',
    });

    const capsules = await generateCapsules(profile);
    expect(capsules.task.text).toBe(taskParagraph);

    const keywordsLine = taskParagraph.split('\n').pop() ?? '';
    const keywords = keywordsLine
      .replace('Keywords:', '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    const evidence = extractLabelingEvidence(
      [
        profile.resumeText,
        ...profile.workExperience,
        ...profile.labelingExperience,
        profile.languages.join('\n'),
        profile.country ?? '',
      ].join('\n')
    );
    const evidenceSet = new Set([...evidence.tokens, ...evidence.phrases]);
    const missing = keywords.filter(
      (keyword) => !evidenceSet.has(keyword.toLowerCase())
    );
    expect(missing).toEqual([]);
  });

  it('allows writing-focused task capsule with explicit prompt evidence', async () => {
    const taskParagraph =
      'The candidate executes prompt writing and response rating for conversational LLM systems, managing pairwise comparisons for RLHF and summarization annotation on news briefs.\nKeywords: prompt writing, response rating, pairwise comparisons, rlhf, summarization';

    mockResponses.push({
      content: `Domain capsule for editorial leadership.\nKeywords: editorial, leadership\n\n${taskParagraph}`,
    });

    const profile = createProfile({
      resumeText: 'Content editor shaping global affairs newsletters.',
      labelingExperience: [
        'Prompt writing and response rating for conversational LLM; pairwise comparisons for RLHF; summarization annotation on news articles.',
      ],
      languages: ['English'],
    });

    const capsules = await generateCapsules(profile);
    expect(capsules.task.text).toBe(taskParagraph);
  });
});
