import { describe, expect, it } from 'vitest';
import { classifyJob, getWeightProfile } from '../src/services/job-classifier';
import { NormalizedJobPosting } from '../src/utils/types';

function createJobPosting(overrides: Partial<NormalizedJobPosting>): NormalizedJobPosting {
  return {
    jobId: 'test-job-1',
    labelTypes: [],
    availableLanguages: [],
    availableCountries: [],
    additionalSkills: [],
    promptText: '',
    sourceText: '',
    ...overrides,
  };
}

describe('classifyJob', () => {
  describe('specialized job classification', () => {
    it('classifies OB-GYN doctor job as specialized', () => {
      const job = createJobPosting({
        title: 'OBGYN Doctors - Large Language Model Training',
        dataSubjectMatter: 'OBGYN',
        expertiseLevel: 'Expert',
        requirementsAdditional:
          '-MD degree with completed residency in Obstetrics and Gynecology.\n-Minimum of 5 years of clinical experience in OBGYN.',
        labelTypes: ['Evaluation/Rating', 'Prompt + Response Writing (SFT)'],
        availableCountries: ['USA', 'UK', 'Canada', 'Australia', 'India', 'Philippines'],
        instructions:
          'OpenTrain AI is seeking experienced OBGYN doctors to help train an AI chatbot specializing in obstetrics and gynecology.',
      });

      const result = classifyJob(job);

      expect(result.jobClass).toBe('specialized');
      expect(result.confidence).toBeGreaterThan(0.5);
      // Check that key signals are present
      expect(result.signals.some((s) => s.includes('credentials_required'))).toBe(true);
      expect(result.signals.some((s) => s.includes('specialized_domain') || s.includes('subject_matter'))).toBe(true);
      expect(result.requirements.credentials).toEqual(expect.arrayContaining(['MD']));
      expect(result.requirements.minimumExperienceYears).toBeGreaterThanOrEqual(5);
    });

    it('classifies legal review job as specialized', () => {
      const job = createJobPosting({
        title: 'Legal Contract Review Specialists',
        dataSubjectMatter: 'Legal - Corporate Law',
        expertiseLevel: 'Expert',
        requirementsAdditional: 'JD required. Must be a practicing attorney with 3+ years experience.',
        labelTypes: ['Expert Review', 'Evaluation/Rating'],
      });

      const result = classifyJob(job);

      expect(result.jobClass).toBe('specialized');
      expect(result.requirements.credentials).toContain('JD');
    });

    it('classifies medical annotation job as specialized when credentials required', () => {
      const job = createJobPosting({
        title: 'Medical Image Annotation',
        dataSubjectMatter: 'Radiology',
        expertiseLevel: 'Specialist',
        requirementsAdditional: 'Board-certified radiologist required. MD with radiology residency.',
        labelTypes: ['Image Classification', 'Evaluation'],
      });

      const result = classifyJob(job);

      expect(result.jobClass).toBe('specialized');
      expect(result.signals).toEqual(
        expect.arrayContaining([expect.stringMatching(/residency/i)])
      );
    });
  });

  describe('generic job classification', () => {
    it('classifies basic bounding box job as generic', () => {
      const job = createJobPosting({
        title: 'Image Annotation - Bounding Boxes',
        dataSubjectMatter: 'General Images',
        expertiseLevel: 'Entry Level - No Experience Required',
        requirementsAdditional: 'Basic computer skills. Attention to detail.',
        labelTypes: ['Bounding Box', 'Image Classification'],
      });

      const result = classifyJob(job);

      expect(result.jobClass).toBe('generic');
      expect(result.signals).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/expertise_level:generic/),
          expect.stringMatching(/label_type:generic/),
        ])
      );
      expect(result.requirements.credentials).toHaveLength(0);
    });

    it('classifies transcription job as generic', () => {
      const job = createJobPosting({
        title: 'Audio Transcription',
        dataSubjectMatter: 'General Audio',
        expertiseLevel: 'Beginner',
        requirementsAdditional: 'Good typing skills. Native English speaker.',
        labelTypes: ['Transcription'],
      });

      const result = classifyJob(job);

      expect(result.jobClass).toBe('generic');
    });

    it('classifies simple tagging job as generic', () => {
      const job = createJobPosting({
        title: 'Video Tagging',
        expertiseLevel: 'Any Level',
        labelTypes: ['Tagging', 'Classification'],
      });

      const result = classifyJob(job);

      expect(result.jobClass).toBe('generic');
    });
  });

  describe('edge cases', () => {
    it('handles job with no expertise level specified', () => {
      const job = createJobPosting({
        title: 'Data Annotation',
        labelTypes: ['Annotation'],
      });

      const result = classifyJob(job);

      // Should default to generic without strong specialized signals
      expect(result.jobClass).toBe('generic');
    });

    it('handles job with mixed signals', () => {
      const job = createJobPosting({
        title: 'Medical Image Bounding Box',
        dataSubjectMatter: 'Medical Images',
        expertiseLevel: 'Intermediate',
        requirementsAdditional: 'Some medical background preferred but not required.',
        labelTypes: ['Bounding Box'],
      });

      const result = classifyJob(job);

      // Medical subject matter suggests specialized, but no hard credential requirements
      // and basic label type suggests generic
      expect(result.confidence).toBeLessThan(0.8); // Lower confidence due to mixed signals
    });

    it('extracts multiple credentials correctly', () => {
      const job = createJobPosting({
        requirementsAdditional: 'MD or DO required. PhD preferred. Must have MRCOG or ABOG certification.',
      });

      const result = classifyJob(job);

      expect(result.requirements.credentials).toEqual(
        expect.arrayContaining(['MD', 'DO', 'PHD', 'MRCOG', 'ABOG'])
      );
    });

    it('correctly extracts experience years', () => {
      const job = createJobPosting({
        requirementsAdditional: 'Minimum of 5 years of clinical experience required.',
      });

      const result = classifyJob(job);

      expect(result.requirements.minimumExperienceYears).toBe(5);
    });

    it('maps subject matter to domain codes', () => {
      const job = createJobPosting({
        dataSubjectMatter: 'OBGYN - Obstetrics and Gynecology',
      });

      const result = classifyJob(job);

      expect(result.requirements.subjectMatterCodes).toEqual(
        expect.arrayContaining(['medical:obgyn'])
      );
    });
  });
});

describe('getWeightProfile', () => {
  it('returns domain-heavy weights for specialized jobs', () => {
    const weights = getWeightProfile('specialized');

    expect(weights.w_domain).toBeGreaterThan(weights.w_task);
    expect(weights.w_domain).toBe(0.85);
    expect(weights.w_task).toBe(0.15);
  });

  it('returns task-heavy weights for generic jobs', () => {
    const weights = getWeightProfile('generic');

    expect(weights.w_task).toBeGreaterThan(weights.w_domain);
    expect(weights.w_domain).toBe(0.3);
    expect(weights.w_task).toBe(0.7);
  });
});
