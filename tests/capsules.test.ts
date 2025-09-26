import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateCapsules, CAPSULE_SYSTEM_MESSAGE, buildCapsulePrompt } from '../src/services/capsules';
import { NormalizedUserProfile } from '../src/utils/types';
import { NO_EVIDENCE_TASK_CAPSULE } from '../src/services/validate';
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
    choices: [
      {
        message: {
          content: response.content,
        },
      },
    ],
  };
});

vi.mock('../src/services/openai-client', () => ({
  getOpenAIClient: () => ({
    chat: {
      completions: {
        create: mockCreate,
      },
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

    expect(prompt).toContain('STRICT RULES');
    expect(prompt).toContain('CAPSULES');
    expect(prompt).toContain('EVIDENCE (use ONLY these tokens/phrases');
    expect(prompt).toContain('prompt writing');
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
          'The candidate delivers comprehensive maternal-fetal medicine care, coordinating obstetric triage protocols and inpatient rounds across labor and delivery units. They integrate prenatal diagnostics, cesarean delivery planning, and postpartum recovery pathways while guiding multidisciplinary collaboration. Keywords: maternal-fetal medicine, obstetric triage, prenatal diagnostics, cesarean delivery, postpartum recovery',
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
          'The candidate architects scalable TypeScript services and React interfaces, optimizing API resilience, CI/CD automation, and distributed systems observability for high-volume deployments. Keywords: TypeScript, React, APIs, CI/CD, distributed systems',
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
          'The candidate curates literary nonfiction programs, shaping cultural reporting, longform essays, and magazine feature pipelines while mentoring editors on narrative structure. Keywords: literary nonfiction, cultural reporting, longform essays, magazine features, narrative structure',
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
          'The candidate steers fixed-income portfolio strategies, structuring municipal bond ladders, credit analysis workflows, and duration hedging for institutional mandates. Keywords: fixed-income, municipal bonds, credit analysis, duration hedging, institutional mandates',
      },
    ];

    for (const { domainText } of profiles) {
      mockResponses.push({
        content: `${domainText}\n\n${NO_EVIDENCE_TASK_CAPSULE}`,
        assert: (payload) => {
          expect(payload.messages[0].content).toBe(CAPSULE_SYSTEM_MESSAGE);
        },
      });
    }

    for (const { profile, noun } of profiles) {
      const capsules = await generateCapsules(profile);
      expect(capsules.domain.text.toLowerCase()).toContain(noun.toLowerCase());
      expect(capsules.domain.text.toLowerCase()).not.toContain('annotation');
      expect(capsules.task.text).toBe(NO_EVIDENCE_TASK_CAPSULE);
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
