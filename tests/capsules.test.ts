import { describe, expect, it } from 'vitest';
import { buildCapsulePrompt, extractCapsuleTexts } from '../src/services/capsules';
import { NormalizedUserProfile } from '../src/utils/types';
import { AppError } from '../src/utils/errors';

const sampleProfile: NormalizedUserProfile = {
  userId: 'u_123',
  resumeText: 'Experienced data annotator specializing in radiology reports and QA.',
  workExperience: ['Radiology annotator at Hospital AI Lab'],
  education: ['BSc Biomedical Engineering'],
  labelingExperience: ['NER for medical terminology', 'Bounding box annotations on CT scans'],
  country: 'US',
  languages: ['English', 'Spanish'],
};

describe('capsule prompt builder', () => {
  it('includes all normalized sections in the prompt', () => {
    const prompt = buildCapsulePrompt(sampleProfile);
    expect(prompt).toContain(sampleProfile.resumeText);
    expect(prompt).toContain(sampleProfile.workExperience[0]);
    expect(prompt).toContain(sampleProfile.education[0]);
    expect(prompt).toContain(sampleProfile.labelingExperience[0]);
    expect(prompt).toContain('English, Spanish');
    expect(prompt).toContain('US');
  });
});

describe('capsule extraction', () => {
  it('returns domain and task capsules when present', () => {
    const response = `Domain capsule text\nKeywords: domain1, domain2\n\nTask capsule text\nKeywords: task1, task2`;
    const capsules = extractCapsuleTexts(response);
    expect(capsules.domain.text).toContain('Domain capsule text');
    expect(capsules.task.text).toContain('Task capsule text');
  });

  it('throws an error when keywords are missing', () => {
    const response = 'Domain capsule text without keywords';
    expect(() => extractCapsuleTexts(response)).toThrow(AppError);
  });
});
