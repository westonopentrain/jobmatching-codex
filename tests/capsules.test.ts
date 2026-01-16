import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateCapsules, CAPSULE_SYSTEM_MESSAGE, buildCapsulePrompt } from '../src/services/capsules';
import { NormalizedUserProfile } from '../src/utils/types';
import { validateSkillsCapsule } from '../src/services/validate';

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

describe('validateSkillsCapsule', () => {
  it('validates skills capsule with keywords', () => {
    const skillsCapsule =
      'Medical writing and editorial review. BMJ content editing, e-learning module development, exam question creation.\nKeywords: medical writing, editorial, BMJ, e-learning';
    const result = validateSkillsCapsule(skillsCapsule);

    expect(result.text).toBe(skillsCapsule);
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('flags missing keywords', () => {
    const skillsCapsule = 'Medical writing and editorial review. BMJ content editing.';
    const result = validateSkillsCapsule(skillsCapsule);

    expect(result.violations).toContain('MISSING_KEYWORDS');
  });

  it('flags too short skills', () => {
    const skillsCapsule = 'Short.\nKeywords: short';
    const result = validateSkillsCapsule(skillsCapsule);

    expect(result.violations).toContain('SKILLS_TOO_SHORT');
  });
});

describe('capsule prompt', () => {
  it('includes decision tree rules for domain and skills capsules', () => {
    const profile = createProfile({
      resumeText: 'Frontend engineer working with React and TypeScript.',
      workExperience: ['Built UI components for logistics dashboards.'],
      labelingExperience: ['Prompt writing and response evaluation for RLHF.'],
      languages: ['English'],
      country: 'US',
    });
    const prompt = buildCapsulePrompt(profile);

    expect(prompt).toContain('CRITICAL CONTEXT');
    expect(prompt).toContain('DOMAIN CAPSULE (WHO is this person? 5-20 words)');
    expect(prompt).toContain('SKILLS CAPSULE (WHAT can this person do? 10-30 words)');
    expect(prompt).toContain('Capture ALL professional skills mentioned in SOURCE');
    expect(prompt).toContain('medical writing');
    expect(prompt).toContain('translation');
  });
});

describe('generateCapsules integration', () => {
  beforeEach(() => {
    mockResponses.length = 0;
    mockCreate.mockClear();
  });

  it('generates domain and skills capsules across multiple domains', async () => {
    const profiles: Array<{ profile: NormalizedUserProfile; noun: string; domainText: string; skillsText: string }> = [
      {
        profile: createProfile({
          userId: 'med',
          resumeText: 'The candidate is an obstetrics specialist focused on maternal-fetal medicine.',
          workExperience: ['OB hospitalist managing labor and delivery triage.'],
          education: ['MD in obstetrics and gynecology.'],
        }),
        noun: 'maternal-fetal medicine',
        domainText:
          'Obstetrics, maternal-fetal medicine, prenatal diagnostics, cesarean delivery planning, postpartum recovery pathways, neonatal care coordination, high-risk pregnancy management.\nKeywords: obstetrics, maternal-fetal medicine, prenatal diagnostics',
        skillsText:
          'Medical practice and clinical care. Labor and delivery management, obstetric triage, patient consultation, prenatal monitoring.\nKeywords: clinical care, obstetric triage, prenatal monitoring',
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
          'TypeScript services, React interfaces, API architecture, CI/CD automation, distributed systems observability, Node.js microservices.\nKeywords: TypeScript, React, API, Node.js',
        skillsText:
          'Software development and code review. API design, CI/CD pipeline configuration, frontend development, microservices architecture.\nKeywords: software development, API design, CI/CD, frontend',
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
          'Literary nonfiction, cultural reporting, longform essays, magazine features, narrative structure, editorial strategy.\nKeywords: literary nonfiction, cultural reporting, editorial',
        skillsText:
          'Writing and editorial review. Longform essay editing, magazine feature development, copyediting, fact-checking.\nKeywords: writing, editorial, editing, copyediting',
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
          'Fixed-income strategy, municipal bonds, credit analysis, duration hedging, institutional mandates, portfolio optimization.\nKeywords: fixed-income, municipal bonds, credit analysis',
        skillsText:
          'Financial analysis and portfolio management. Credit analysis, bond portfolio construction, risk assessment, financial modeling.\nKeywords: financial analysis, credit analysis, portfolio management',
      },
    ];

    for (const { domainText, skillsText } of profiles) {
      mockResponses.push({
        content: `${domainText}\n\n${skillsText}`,
        assert: (payload) => {
          expect(payload.input[0].content).toBe(CAPSULE_SYSTEM_MESSAGE);
        },
      });
    }

    for (const { profile, noun, skillsText } of profiles) {
      const capsules = await generateCapsules(profile);
      expect(capsules.domain.text.toLowerCase()).toContain(noun.toLowerCase());
      expect(capsules.domain.text.toLowerCase()).not.toContain('annotation');
      // Skills capsule should be preserved as-is (not replaced with fixed sentence)
      expect(capsules.task.text).toBe(skillsText);
      expect(capsules.domain.text).toMatch(/Keywords:/);
      expect(capsules.task.text).toMatch(/Keywords:/);
    }
  });

  it('preserves skills capsule content for all users', async () => {
    const skillsText =
      'Healthcare operations and scheduling. Perioperative staffing coordination, surgical schedule management, resource allocation.\nKeywords: healthcare operations, scheduling, staffing';

    mockResponses.push({
      content:
        `Healthcare revenue cycle management, surgical scheduling, perioperative coordination.\nKeywords: healthcare, revenue cycle, surgical\n\n${skillsText}`,
    });

    const profile = createProfile({
      resumeText: 'Healthcare operations manager overseeing surgical schedules.',
      workExperience: ['Coordinated perioperative staffing.'],
      education: ['MBA Healthcare Management.'],
    });

    const capsules = await generateCapsules(profile);
    // Skills capsule should be preserved - captures all professional skills
    expect(capsules.task.text).toBe(skillsText);
    expect(capsules.task.text).toContain('Healthcare operations');
  });

  it('preserves skills capsule for code annotation and labeling evidence', async () => {
    const skillsText =
      'UI annotation and code review. Screenshot annotation with bounding boxes in Label Studio, HTML/CSS/JS interface tagging, code diff classification, prompt writing for SFT.\nKeywords: annotation, bounding box, label studio, code review, prompt writing';

    mockResponses.push({
      content: `Frontend engineering and design systems.\nKeywords: frontend, design systems\n\n${skillsText}`,
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
    expect(capsules.task.text).toBe(skillsText);
    expect(capsules.task.text).toContain('annotation');
    expect(capsules.task.text).toContain('Label Studio');
  });

  it('captures writing and RLHF skills in skills capsule', async () => {
    const skillsText =
      'Content editing and LLM evaluation. Prompt writing, response rating for conversational systems, pairwise comparisons for RLHF, summarization annotation.\nKeywords: prompt writing, response rating, RLHF, summarization, content editing';

    mockResponses.push({
      content: `Editorial leadership and content strategy.\nKeywords: editorial, content strategy\n\n${skillsText}`,
    });

    const profile = createProfile({
      resumeText: 'Content editor shaping global affairs newsletters.',
      labelingExperience: [
        'Prompt writing and response rating for conversational LLM; pairwise comparisons for RLHF; summarization annotation on news articles.',
      ],
      languages: ['English'],
    });

    const capsules = await generateCapsules(profile);
    expect(capsules.task.text).toBe(skillsText);
    expect(capsules.task.text).toContain('RLHF');
    expect(capsules.task.text).toContain('prompt writing');
  });
});
