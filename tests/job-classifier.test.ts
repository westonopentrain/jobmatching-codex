import { describe, expect, it } from 'vitest';
import { classifyJobSync, getWeightProfile } from '../src/services/job-classifier';
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

describe('classifyJobSync (fallback classification)', () => {
  describe('specialized job classification', () => {
    it('classifies job with MD requirement as specialized', () => {
      const job = createJobPosting({
        title: 'OBGYN Doctors - Large Language Model Training',
        dataSubjectMatter: 'OBGYN',
        expertiseLevel: 'Expert',
        requirementsAdditional:
          '-MD degree with completed residency in Obstetrics and Gynecology.\n-Minimum of 5 years of clinical experience in OBGYN.',
        labelTypes: ['Evaluation/Rating', 'Prompt + Response Writing (SFT)'],
      });

      const result = classifyJobSync(job);

      expect(result.jobClass).toBe('specialized');
    });

    it('classifies legal review job as specialized', () => {
      const job = createJobPosting({
        title: 'Legal Contract Review Specialists',
        dataSubjectMatter: 'Legal - Corporate Law',
        expertiseLevel: 'Expert',
        requirementsAdditional: 'JD required. Must be a practicing attorney with 3+ years experience.',
        labelTypes: ['Expert Review', 'Evaluation/Rating'],
      });

      const result = classifyJobSync(job);

      expect(result.jobClass).toBe('specialized');
    });

    it('classifies medical annotation job as specialized when credentials required', () => {
      const job = createJobPosting({
        title: 'Medical Image Annotation',
        dataSubjectMatter: 'Radiology',
        expertiseLevel: 'Specialist',
        requirementsAdditional: 'Board-certified radiologist required. MD with radiology residency.',
        labelTypes: ['Image Classification', 'Evaluation'],
      });

      const result = classifyJobSync(job);

      expect(result.jobClass).toBe('specialized');
    });

    it('classifies PhD research job as specialized', () => {
      const job = createJobPosting({
        title: 'AI Research Evaluation',
        dataSubjectMatter: 'Machine Learning',
        expertiseLevel: 'Expert',
        requirementsAdditional: 'PhD in Computer Science or related field required.',
      });

      const result = classifyJobSync(job);

      expect(result.jobClass).toBe('specialized');
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

      const result = classifyJobSync(job);

      expect(result.jobClass).toBe('generic');
    });

    it('classifies transcription job as generic', () => {
      const job = createJobPosting({
        title: 'Audio Transcription',
        dataSubjectMatter: 'General Audio',
        expertiseLevel: 'Beginner',
        requirementsAdditional: 'Good typing skills. Native English speaker.',
        labelTypes: ['Transcription'],
      });

      const result = classifyJobSync(job);

      expect(result.jobClass).toBe('generic');
    });

    it('classifies simple tagging job as generic', () => {
      const job = createJobPosting({
        title: 'Video Tagging',
        expertiseLevel: 'Any Level',
        labelTypes: ['Tagging', 'Classification'],
      });

      const result = classifyJobSync(job);

      expect(result.jobClass).toBe('generic');
    });

    it('classifies entry level job without credentials as generic', () => {
      const job = createJobPosting({
        title: 'Data Annotation',
        expertiseLevel: 'entry',
        requirementsAdditional: 'No experience required',
        labelTypes: ['Annotation'],
      });

      const result = classifyJobSync(job);

      expect(result.jobClass).toBe('generic');
    });
  });

  describe('edge cases', () => {
    it('handles job with no expertise level specified', () => {
      const job = createJobPosting({
        title: 'Data Annotation',
        labelTypes: ['Annotation'],
      });

      const result = classifyJobSync(job);

      // Should default to generic without strong specialized signals
      expect(result.jobClass).toBe('generic');
    });

    it('handles empty job posting', () => {
      const job = createJobPosting({});

      const result = classifyJobSync(job);

      expect(result.jobClass).toBe('generic');
      expect(result.confidence).toBe(0.5);
    });

    it('specialized signals override generic label types', () => {
      const job = createJobPosting({
        title: 'Medical Bounding Box Annotation',
        requirementsAdditional: 'MD required for medical image annotation',
        labelTypes: ['Bounding Box'],
      });

      const result = classifyJobSync(job);

      // MD requirement should make this specialized despite bounding box label type
      expect(result.jobClass).toBe('specialized');
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
