/**
 * Integration tests for job and user classifiers with realistic STEM job postings.
 * Tests specialized engineering, coding, and science roles for LLM evaluation/training.
 *
 * NOTE: These tests use the synchronous fallback classification which uses heuristics,
 * not the full LLM-based classification. The fallback provides basic classification
 * but doesn't extract detailed metadata like specific credentials or domain codes.
 */

import { describe, expect, it } from 'vitest';
import { classifyJobSync, getWeightProfile } from '../src/services/job-classifier';
import { classifyUserSync, shouldExcludeFromGenericJob, isEligibleForSpecializedJob } from '../src/services/user-classifier';
import { NormalizedJobPosting, NormalizedUserProfile } from '../src/utils/types';

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

// Helper to create normalized user profiles
function createUser(overrides: Partial<NormalizedUserProfile>): NormalizedUserProfile {
  return {
    userId: 'test-user',
    resumeText: '',
    workExperience: [],
    education: [],
    labelingExperience: [],
    languages: [],
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

describe('User Classification for Engineering Domains', () => {
  describe('Qualified Civil Engineer', () => {
    const civilEngineer = createUser({
      userId: 'civil-eng-001',
      resumeText: `
        Licensed Professional Engineer (PE) with 12 years of experience in civil engineering.
        PhD in Civil Engineering, Stanford University.
        Senior Structural Engineer at AECOM.
      `,
      workExperience: ['Senior Structural Engineer at AECOM'],
      education: ['PhD Civil Engineering, Stanford University'],
    });

    it('classifies civil engineer as domain expert', () => {
      const result = classifyUserSync(civilEngineer);

      expect(result.userClass).toBe('domain_expert');
      expect(result.hasLabelingExperience).toBe(false);
    });

    it('should be excluded from basic bounding box jobs', () => {
      const userResult = classifyUserSync(civilEngineer);

      expect(shouldExcludeFromGenericJob(userResult)).toBe(true);
    });
  });

  describe('Senior Software Engineer', () => {
    const softwareEngineer = createUser({
      userId: 'swe-001',
      resumeText: `
        Senior Software Engineer with 8 years of experience at top tech companies.
        Staff Engineer at Google, leading ML infrastructure team.
        MS Computer Science, MIT.
      `,
      workExperience: ['Staff Engineer at Google'],
      education: ['MS Computer Science, MIT'],
    });

    it('classifies software engineer as domain expert', () => {
      const result = classifyUserSync(softwareEngineer);

      expect(result.userClass).toBe('domain_expert');
    });
  });

  describe('ML Researcher with Labeling Experience', () => {
    const mlResearcher = createUser({
      userId: 'ml-researcher-001',
      resumeText: `
        Machine Learning Researcher and AI Trainer at OpenAI.
        PhD in Computer Science, Stanford University.
        RLHF data collection lead. Scale AI expert annotator.
      `,
      workExperience: ['Research Scientist at OpenAI'],
      education: ['PhD Computer Science, Stanford University'],
      labelingExperience: [
        'RLHF data collection for GPT-4',
        'Scale AI code annotation',
      ],
    });

    it('classifies ML researcher with labeling experience as mixed', () => {
      const result = classifyUserSync(mlResearcher);

      expect(result.userClass).toBe('mixed');
      expect(result.hasLabelingExperience).toBe(true);
    });

    it('should NOT be excluded from generic jobs (has labeling experience)', () => {
      const result = classifyUserSync(mlResearcher);

      expect(shouldExcludeFromGenericJob(result)).toBe(false);
    });
  });

  describe('General Data Labeler', () => {
    const dataLabeler = createUser({
      userId: 'labeler-001',
      resumeText: `
        Experienced data annotator with 3 years of remote work experience.
        Platforms: Scale AI, Appen, Remotasks, Amazon MTurk.
        Completed 10,000+ annotation tasks.
      `,
      labelingExperience: [
        'Scale AI - Image annotation, bounding boxes',
        'Appen - Audio transcription',
        'MTurk - Various annotation tasks',
      ],
    });

    it('classifies data labeler as general labeler', () => {
      const result = classifyUserSync(dataLabeler);

      expect(result.userClass).toBe('general_labeler');
      expect(result.hasLabelingExperience).toBe(true);
    });

    it('should NOT be excluded from generic jobs', () => {
      const result = classifyUserSync(dataLabeler);

      expect(shouldExcludeFromGenericJob(result)).toBe(false);
    });
  });
});

describe('Cross-Domain Matching Scenarios', () => {
  it('general labeler should be matched to generic jobs', () => {
    const labeler = createUser({
      resumeText: 'Freelance annotator working on Scale AI and Appen.',
      labelingExperience: ['Bounding box annotation', 'Image classification'],
    });

    const labelerResult = classifyUserSync(labeler);

    const boundingBoxJob = createJob({
      title: 'Image Annotator',
      expertiseLevel: 'Entry Level',
      labelTypes: ['Bounding Box'],
    });

    const jobResult = classifyJobSync(boundingBoxJob);

    expect(labelerResult.userClass).toBe('general_labeler');
    expect(jobResult.jobClass).toBe('generic');
    expect(shouldExcludeFromGenericJob(labelerResult)).toBe(false);
  });

  it('PhD engineer should NOT receive generic bounding box job', () => {
    const phdEngineer = createUser({
      resumeText: 'PhD in Electrical Engineering. Professor at Stanford. 20 years experience.',
      education: ['PhD Electrical Engineering, Stanford'],
    });

    const result = classifyUserSync(phdEngineer);

    expect(result.userClass).toBe('domain_expert');
    expect(shouldExcludeFromGenericJob(result)).toBe(true);
  });

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
