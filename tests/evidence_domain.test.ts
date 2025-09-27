import { describe, expect, it } from 'vitest';

import { extractDomainEvidence } from '../src/utils/evidence_domain';

describe('extractDomainEvidence', () => {
  it('captures domain specialties and filters logistics terms', () => {
    const jobText = `Title: OB-GYN Reviewer
Instructions: Review obstetrics and gynecology content for maternal-fetal medicine guidance.
Requirements_Additional: Must hold an MD, have completed OB-GYN residency, and maintain board certification. Accuracy, empathy, and flexible scheduling are valued.`;

    const evidence = extractDomainEvidence(jobText);
    expect(evidence.tokens).toContain('obstetrics');
    expect(evidence.tokens).toContain('gynecology');
    expect(evidence.tokens).toContain('MD');
    expect(evidence.tokens).not.toContain('accuracy');
    expect(evidence.tokens).not.toContain('scheduling');
    expect(evidence.phrases).toContain('maternal-fetal medicine');
  });

  it('only keeps language tokens when framed as subject matter', () => {
    const jobText = `Title: Spanish Medical Content Reviewer
Requirements_Additional: Evaluate Spanish medical terminology and prenatal care narratives.
AdditionalSkills: Spanish fluency, obstetric ultrasound interpretation.`;

    const evidence = extractDomainEvidence(jobText);
    expect(evidence.tokens).toContain('spanish');
    expect(evidence.tokens).toContain('medical');
  });
});
