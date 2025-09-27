import { describe, expect, it, vi } from 'vitest';

import {
  validateDomainCapsuleText,
  validateTaskCapsuleText,
  RewriteCapsuleFn,
} from '../src/services/validate_job_capsules';
import { DomainEvidence } from '../src/utils/evidence_domain';
import { LabelingEvidenceResult } from '../src/utils/evidence';

const obgynDomainEvidence: DomainEvidence = {
  tokens: [
    'OB-GYN',
    'obstetrics',
    'gynecology',
    'prenatal',
    'care',
    'MD',
    'residency',
    'clinical',
    'practice',
    "women's",
    'health',
  ],
  phrases: [
    'maternal-fetal medicine',
    'prenatal care',
    'labor and delivery',
    'gynecologic surgery',
    'obstetric ultrasound',
    'clinical practice',
    "women's health",
  ],
};

const obgynTaskEvidence: LabelingEvidenceResult = {
  tokens: [
    'evaluation',
    'rating',
    'prompt writing',
    'response writing',
    'supervised fine-tuning',
    'SFT',
    'rubric',
    'text modality',
    'annotation review',
    'quality review',
    'workflow',
  ],
  phrases: ['evaluation rating', 'prompt and response writing', 'supervised fine-tuning rubric'],
};

describe('validateJobCapsules', () => {
  it('rewrites domain capsule to remove brackets and soft skills', async () => {
    const raw = `<OB-GYN, obstetrics, gynecology, maternal-fetal medicine> Clinicians must show empathy and flexible scheduling.
Keywords: OB-GYN, empathy, scheduling, obstetrics`;

    const cleanedParagraph =
      "The assignment focuses on obstetrics and gynecology / OB-GYN expertise, highlighting maternal-fetal medicine, prenatal care, labor and delivery, gynecologic surgery, and obstetric ultrasound. Candidates must hold an MD, complete residency training, and sustain clinical practice across women's health services.";

    const rewrite: RewriteCapsuleFn = vi
      .fn()
      .mockResolvedValue(cleanedParagraph);

    const result = await validateDomainCapsuleText(raw, { evidence: obgynDomainEvidence }, { rewrite });

    expect(rewrite).toHaveBeenCalled();
    const directive = rewrite.mock.calls[0]?.[1] ?? '';
    expect(directive).toContain('angle brackets');
    expect(result).not.toContain('<');
    expect(result).not.toContain('empathy');
    const [, keywordsLine] = result.split('\n');
    expect(keywordsLine).toMatch(/^Keywords:/);
    const keywords = keywordsLine.replace('Keywords: ', '').split(/,\s*/);
    expect(keywords.length).toBeGreaterThanOrEqual(10);
    for (const keyword of keywords) {
      expect([...obgynDomainEvidence.tokens, ...obgynDomainEvidence.phrases].map((term) => term.toLowerCase())).toContain(
        keyword.toLowerCase()
      );
    }
  });

  it('removes logistics from task capsule and enforces evidence keywords', async () => {
    const raw = `Freelance labelers with flexible schedules review prompts and responses, set their own pay, and occasionally audit outputs.
Keywords: freelance, schedule, pay`;

    const cleanedTask =
      'Reviewers perform evaluation rating on medical prompt and response datasets, author prompt writing and response writing exemplars, and apply supervised fine-tuning (SFT) rubric checks across proprietary text modality workflows. Annotation review and quality review loops maintain calibration, ensuring each workflow follows the documented evaluation rating rubric.';

    const rewrite: RewriteCapsuleFn = vi
      .fn()
      .mockResolvedValue(cleanedTask);

    const result = await validateTaskCapsuleText(raw, { evidence: obgynTaskEvidence }, { rewrite });

    expect(rewrite).toHaveBeenCalled();
    const [, keywordsLine] = result.split('\n');
    expect(keywordsLine).toMatch(/^Keywords:/);
    const keywords = keywordsLine.replace('Keywords: ', '').split(/,\s*/);
    expect(keywords.length).toBeGreaterThanOrEqual(10);
    for (const keyword of keywords) {
      expect([...obgynTaskEvidence.tokens, ...obgynTaskEvidence.phrases].map((term) => term.toLowerCase())).toContain(
        keyword.toLowerCase()
      );
    }
    expect(result).not.toContain('Freelance');
    expect(result).not.toContain('pay');
  });

  it('strips hiring and marketing language from domain capsule', async () => {
    const raw = `OpenTrain is seeking candidates for an OBGYN project, prioritizing availability, flexible schedules, and strong English writing to support patients with clarity.
Keywords: seeking, candidates, availability`;

    const cleanedParagraph =
      "The role concentrates on obstetrics and gynecology / OB-GYN depth across maternal-fetal medicine, prenatal care, labor and delivery, gynecologic surgery, obstetric ultrasound, and ongoing MD residency-backed clinical practice in women's health.";

    const rewrite: RewriteCapsuleFn = vi
      .fn()
      .mockResolvedValue(cleanedParagraph);

    const result = await validateDomainCapsuleText(raw, { evidence: obgynDomainEvidence }, { rewrite });

    expect(rewrite).toHaveBeenCalled();
    const directive = rewrite.mock.calls[0]?.[1] ?? '';
    expect(directive).toContain('hiring/logistics/marketing language');
    expect(result.toLowerCase()).not.toContain('seeking');
    expect(result.toLowerCase()).not.toContain('candidates');
    expect(result.toLowerCase()).not.toContain('availability');
  });

  it('returns clean keywords without invoking rewrite when text is compliant', async () => {
    const codingDomain: DomainEvidence = {
      tokens: ['html', 'css', 'javascript', 'react', 'wcag', 'front-end', 'responsive', 'design', 'inclusive', 'systems'],
      phrases: ['front-end web development', 'responsive design', 'wcag compliance', 'inclusive design systems'],
    };
    const codingTask: LabelingEvidenceResult = {
      tokens: [
        'code annotation',
        'ui tagging',
        'component labeling',
        'design token mapping',
        'screenshot review',
        'front-end QA',
      ],
      phrases: ['code annotation workflow'],
    };

    const domainBody =
      'This role targets front-end web development expertise across HTML, CSS, and JavaScript frameworks such as React, emphasizing responsive design principles, WCAG compliance, and inclusive design systems.';
    const taskBody =
      'Contributors execute code annotation workflow steps for UI tagging, component labeling, and screenshot review, perform design token mapping, document workflow procedures, and deliver front-end QA audits for interface behaviour.';

    const rewrite: RewriteCapsuleFn = vi.fn(async (paragraph) => paragraph);

    const domainResult = await validateDomainCapsuleText(`${domainBody}\nKeywords: placeholder`, {
      evidence: codingDomain,
    }, { rewrite });
    const taskResult = await validateTaskCapsuleText(`${taskBody}\nKeywords: placeholder`, { evidence: codingTask }, { rewrite });

    expect(rewrite).not.toHaveBeenCalled();
    expect(domainResult).toContain('Keywords:');
    expect(taskResult).toContain('Keywords:');
  });

  it('recomputes keywords when original line includes invalid tokens', async () => {
    const raw = `Obstetrics and gynecology specialists support prenatal care, labor and delivery, gynecologic surgery, obstetric ultrasound, and maternal-fetal medicine while maintaining MD residency standards and ongoing clinical practice across women's health.
Keywords: invalid, token, here`;

    const rewrite: RewriteCapsuleFn = vi.fn(async (paragraph) => paragraph);

    const result = await validateDomainCapsuleText(raw, { evidence: obgynDomainEvidence }, { rewrite });

    expect(rewrite).not.toHaveBeenCalled();

    const [, keywordsLine] = result.split('\n');
    expect(keywordsLine).toMatch(/^Keywords:/);
    const keywords = keywordsLine.replace('Keywords: ', '').split(/,\s*/);
    for (const keyword of keywords) {
      expect([...obgynDomainEvidence.tokens, ...obgynDomainEvidence.phrases].map((term) => term.toLowerCase())).toContain(
        keyword.toLowerCase()
      );
    }
  });

  it('triggers rewrite when angle brackets persist after first pass', async () => {
    const raw = `<Task> Evaluate prompts </Task>
Keywords: prompts, evaluation`;

    const rewrite = vi
      .fn<Parameters<RewriteCapsuleFn>, ReturnType<RewriteCapsuleFn>>()
      .mockResolvedValue(
        'Evaluate prompts and responses using evaluation rating rubrics, prompt writing and response writing exemplars, supervised fine-tuning (SFT) checklist reviews, annotation review audits, quality review passes, and text modality workflow documentation.'
      );

    const result = await validateTaskCapsuleText(raw, { evidence: obgynTaskEvidence }, { rewrite });
    expect(rewrite).toHaveBeenCalled();
    expect(result).not.toContain('<');
  });

  it('rewrites chant-like task capsules that repeat the same words', async () => {
    const raw = `Labeling evaluation workflow labeling evaluation workflow labeling evaluation workflow labeling evaluation workflow.
Keywords: labeling, evaluation`;

    const cleanedTask =
      'Specialists run evaluation rating workflows, craft prompt writing and response writing exemplars, execute supervised fine-tuning (SFT) rubric reviews, and perform annotation review plus quality review audits across the medical text modality dataset.';

    const rewrite: RewriteCapsuleFn = vi
      .fn()
      .mockResolvedValue(cleanedTask);

    const result = await validateTaskCapsuleText(raw, { evidence: obgynTaskEvidence }, { rewrite });

    expect(rewrite).toHaveBeenCalled();
    const directive = rewrite.mock.calls[0]?.[1] ?? '';
    expect(directive).toContain('chant-like');
    expect(result.toLowerCase()).not.toContain('labeling evaluation workflow labeling');
  });
});
