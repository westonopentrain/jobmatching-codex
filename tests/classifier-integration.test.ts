/**
 * Integration tests for job classifier with realistic STEM job postings.
 * Tests specialized engineering, coding, and science roles for LLM evaluation/training.
 *
 * NOTE: These tests use the synchronous fallback classification which uses heuristics,
 * not the full LLM-based classification. The fallback provides basic classification
 * but doesn't extract detailed metadata like specific credentials or domain codes.
 */

import { describe, expect, it } from 'vitest';
import { classifyJobSync, getWeightProfile } from '../src/services/job-classifier';
import { NormalizedJobPosting } from '../src/utils/types';

// Helper to create normalized job postings
function createJob(overrides: Partial<NormalizedJobPosting>): NormalizedJobPosting {
  return {
    jobId: 'test-job',
    labelTypes: [],
    availableLanguages: [],
    availableCountries: [],
    additionalSkills: [],
    promptText: '',
    sourceText: '',
    ...overrides,
  };
}

describe('STEM Domain Expert Job Classifications', () => {
  describe('Civil Engineering - LLM Evaluation', () => {
    const civilEngineeringJob = createJob({
      jobId: 'civil-eng-llm-eval-001',
      title: 'Civil Engineering Expert - AI Training & Evaluation',
      dataSubjectMatter: 'Civil Engineering',
      expertiseLevel: 'Expert - PhD or Masters Required',
      requirementsAdditional: `
        We are looking for the top 1% of civil engineers worldwide.
        Qualifications:
        - PhD or Master's Degree in Civil Engineering
        - Professional Engineer (PE) license preferred
        - Minimum 5 years of professional engineering experience
      `,
      labelTypes: ['Evaluation/Rating', 'Expert Review'],
    });

    it('classifies civil engineering job as specialized', () => {
      const result = classifyJobSync(civilEngineeringJob);

      // Fallback detects "engineering" and "civil" keywords -> specialized
      expect(result.jobClass).toBe('specialized');
    });

    it('returns appropriate weight profile for specialized job', () => {
      const result = classifyJobSync(civilEngineeringJob);
      const weights = getWeightProfile(result.jobClass);

      expect(weights.w_domain).toBe(0.85);
      expect(weights.w_task).toBe(0.15);
    });
  });

  describe('Mechanical Engineering - AI Training', () => {
    const mechanicalEngineeringJob = createJob({
      jobId: 'mech-eng-ai-001',
      title: 'Mechanical Engineering Specialist - AI Model Training',
      dataSubjectMatter: 'Mechanical Engineering',
      expertiseLevel: 'Specialist',
      requirementsAdditional: `
        Master's or PhD in Mechanical Engineering required.
        7+ years of industry experience in mechanical design.
        PE certification preferred.
      `,
      labelTypes: ['Evaluation/Rating', 'Expert Review'],
    });

    it('classifies mechanical engineering job as specialized', () => {
      const result = classifyJobSync(mechanicalEngineeringJob);

      expect(result.jobClass).toBe('specialized');
    });
  });

  describe('Software Engineering - Code Evaluation', () => {
    const softwareEngineeringJob = createJob({
      jobId: 'swe-code-eval-001',
      title: 'Senior Software Engineer - Code LLM Evaluation',
      dataSubjectMatter: 'Software Engineering - Code',
      expertiseLevel: 'Senior/Expert',
      requirementsAdditional: `
        BS/MS/PhD in Computer Science required.
        5+ years of professional software development experience.
        Experience at a top tech company preferred.
      `,
      labelTypes: ['Code Review', 'Evaluation/Rating', 'RLHF'],
    });

    it('classifies software engineering code evaluation as specialized', () => {
      const result = classifyJobSync(softwareEngineeringJob);

      // Fallback detects PhD in requirements -> specialized
      expect(result.jobClass).toBe('specialized');
    });
  });

  describe('Physics Expert - Scientific AI Training', () => {
    const physicsJob = createJob({
      jobId: 'physics-ai-001',
      title: 'Physics Expert - Scientific AI Training',
      dataSubjectMatter: 'Physics, Chemistry, Scientific Research',
      expertiseLevel: 'PhD Required',
      requirementsAdditional: `
        PhD in Physics, Chemistry, or related physical science required.
        5+ years post-PhD experience.
      `,
      labelTypes: ['Evaluation/Rating', 'Expert Review'],
    });

    it('classifies physics expert job as specialized', () => {
      const result = classifyJobSync(physicsJob);

      expect(result.jobClass).toBe('specialized');
    });
  });
});

describe('Generic Labeling Job Classifications', () => {
  describe('Basic Image Annotation - Bounding Boxes', () => {
    const boundingBoxJob = createJob({
      jobId: 'bbox-basic-001',
      title: 'Image Annotator - Bounding Box Labeling',
      dataSubjectMatter: 'General Images',
      expertiseLevel: 'Entry Level - No Experience Required',
      requirementsAdditional: `
        Simple image annotation task. No specialized skills required.
        Basic computer skills needed.
        No prior experience needed.
      `,
      labelTypes: ['Bounding Box', 'Image Classification'],
    });

    it('classifies basic bounding box job as generic', () => {
      const result = classifyJobSync(boundingBoxJob);

      expect(result.jobClass).toBe('generic');
    });

    it('returns task-heavy weight profile for generic job', () => {
      const result = classifyJobSync(boundingBoxJob);
      const weights = getWeightProfile(result.jobClass);

      expect(weights.w_domain).toBe(0.3);
      expect(weights.w_task).toBe(0.7);
    });
  });

  describe('Audio Transcription - General', () => {
    const transcriptionJob = createJob({
      jobId: 'transcription-001',
      title: 'Audio Transcription Specialist',
      dataSubjectMatter: 'General Audio Content',
      expertiseLevel: 'Beginner',
      requirementsAdditional: `
        Transcribe audio recordings into text.
        Good typing skills required.
        No degree required.
      `,
      labelTypes: ['Transcription', 'Audio Annotation'],
    });

    it('classifies transcription job as generic', () => {
      const result = classifyJobSync(transcriptionJob);

      expect(result.jobClass).toBe('generic');
    });
  });

  describe('Simple Video Tagging', () => {
    const videoTaggingJob = createJob({
      jobId: 'video-tag-001',
      title: 'Video Content Tagger',
      expertiseLevel: 'Any Level',
      requirementsAdditional: 'Tag video content with relevant labels. No experience needed.',
      labelTypes: ['Tagging', 'Video Classification'],
    });

    it('classifies simple tagging job as generic', () => {
      const result = classifyJobSync(videoTaggingJob);

      expect(result.jobClass).toBe('generic');
    });
  });
});

describe('Credential Override Scenarios', () => {
  it('credential requirement overrides generic label type', () => {
    const medicalAnnotationJob = createJob({
      title: 'Medical Image Annotation',
      requirementsAdditional: 'MD required for radiology image annotation.',
      labelTypes: ['Bounding Box'],
    });

    const result = classifyJobSync(medicalAnnotationJob);

    // MD credential should make it specialized even with bounding box label
    expect(result.jobClass).toBe('specialized');
  });
});

describe('Weight Profile Selection', () => {
  it('specialized jobs get domain-heavy weights', () => {
    const weights = getWeightProfile('specialized');

    expect(weights.w_domain).toBeGreaterThan(weights.w_task);
    expect(weights.w_domain).toBe(0.85);
    expect(weights.w_task).toBe(0.15);
  });

  it('generic jobs get task-heavy weights', () => {
    const weights = getWeightProfile('generic');

    expect(weights.w_task).toBeGreaterThan(weights.w_domain);
    expect(weights.w_domain).toBe(0.3);
    expect(weights.w_task).toBe(0.7);
  });
});
