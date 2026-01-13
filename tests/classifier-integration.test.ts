/**
 * Integration tests for job and user classifiers with realistic STEM job postings.
 * Tests specialized engineering, coding, and science roles for LLM evaluation/training.
 */

import { describe, expect, it } from 'vitest';
import { classifyJob, JobClassificationResult } from '../src/services/job-classifier';
import { classifyUser, UserClassificationResult, shouldExcludeFromGenericJob, isEligibleForSpecializedJob } from '../src/services/user-classifier';
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
  describe('Civil Engineering - LLM Evaluation (Outlier/Scale AI style)', () => {
    const civilEngineeringJob = createJob({
      jobId: 'civil-eng-llm-eval-001',
      title: 'Civil Engineering Expert - AI Training & Evaluation',
      dataSubjectMatter: 'Civil Engineering',
      expertiseLevel: 'Expert - PhD or Masters Required',
      requirementsAdditional: `
        We are looking for the top 1% of civil engineers worldwide to shape the future of AI.

        Qualifications:
        - PhD or Master's Degree in Civil Engineering or related field (currently enrolled accepted)
        - Deep subject matter expertise with the ability to create complex, graduate-level problems that challenge AI reasoning
        - Professional Engineer (PE) license preferred
        - Strong analytical and problem-solving skills
        - Experience in structural analysis, geotechnical engineering, or transportation engineering
        - Minimum 5 years of professional engineering experience
        - Fluency in English required

        You will help improve AI models by:
        - Developing and answering expert-level civil engineering questions
        - Assessing and ranking AI responses based on engineering rigor
        - Evaluating structural calculations, load analysis, and design specifications
        - Providing feedback on AI-generated engineering solutions
      `,
      labelTypes: ['Evaluation/Rating', 'Prompt + Response Writing (SFT)', 'Expert Review'],
      availableCountries: ['USA', 'Canada', 'UK', 'Australia', 'Germany'],
      availableLanguages: ['English'],
      instructions: `
        As a Civil Engineering expert, you will train AI models to understand complex engineering concepts
        including structural mechanics, soil mechanics, hydraulics, and construction management.
        Your expertise will help ensure AI can provide accurate and safe engineering guidance.
      `,
    });

    it('classifies civil engineering LLM evaluation job as specialized', () => {
      const result = classifyJob(civilEngineeringJob);

      expect(result.jobClass).toBe('specialized');
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.requirements.credentials).toEqual(expect.arrayContaining(['PE']));
      expect(result.requirements.minimumExperienceYears).toBeGreaterThanOrEqual(5);
      // PE + 5 years = expert tier (specialist requires PhD or 10+ years)
      expect(['expert', 'specialist']).toContain(result.requirements.expertiseTier);
    });

    it('extracts civil engineering domain codes', () => {
      const result = classifyJob(civilEngineeringJob);

      expect(result.requirements.subjectMatterCodes).toEqual(
        expect.arrayContaining(['engineering:civil'])
      );
    });
  });

  describe('Mechanical Engineering - AI Training (Outlier style)', () => {
    const mechanicalEngineeringJob = createJob({
      jobId: 'mech-eng-ai-001',
      title: 'Mechanical Engineering Specialist - AI Model Training',
      dataSubjectMatter: 'Mechanical Engineering',
      expertiseLevel: 'Specialist',
      requirementsAdditional: `
        Join our team of world-class engineers helping to train the next generation of AI systems.

        Requirements:
        - Master's or PhD in Mechanical Engineering, Aerospace Engineering, or related field
        - Professional Engineer (PE) certification preferred
        - 7+ years of industry experience in mechanical design, thermodynamics, or fluid mechanics
        - Experience with CAD/CAE software (SolidWorks, ANSYS, etc.)
        - Strong background in materials science, heat transfer, or manufacturing processes
        - Excellent technical writing skills

        Responsibilities:
        - Create challenging engineering problems for AI evaluation
        - Review and rate AI-generated mechanical engineering solutions
        - Provide expert feedback on thermodynamics, mechanics, and design problems
        - Help develop evaluation rubrics for engineering accuracy
      `,
      labelTypes: ['Evaluation/Rating', 'Response Writing', 'Expert Review'],
      availableCountries: ['USA', 'Canada', 'UK', 'Germany', 'Japan'],
      availableLanguages: ['English'],
      instructions: `
        Help train AI to understand mechanical engineering principles including
        thermodynamics, fluid mechanics, machine design, and manufacturing.
      `,
    });

    it('classifies mechanical engineering job as specialized', () => {
      const result = classifyJob(mechanicalEngineeringJob);

      expect(result.jobClass).toBe('specialized');
      expect(result.requirements.credentials).toEqual(expect.arrayContaining(['PE']));
      expect(result.requirements.minimumExperienceYears).toBeGreaterThanOrEqual(7);
    });

    it('extracts mechanical engineering domain', () => {
      const result = classifyJob(mechanicalEngineeringJob);

      expect(result.requirements.subjectMatterCodes).toEqual(
        expect.arrayContaining(['engineering:mechanical'])
      );
    });
  });

  describe('Software Engineering - Code Evaluation (Scale AI style)', () => {
    const softwareEngineeringJob = createJob({
      jobId: 'swe-code-eval-001',
      title: 'Senior Software Engineer - Code LLM Evaluation',
      dataSubjectMatter: 'Software Engineering - Code',
      expertiseLevel: 'Senior/Expert',
      requirementsAdditional: `
        We're building the most advanced code LLMs in the world, and we need expert software engineers
        to evaluate and improve their capabilities.

        Requirements:
        - BS/MS/PhD in Computer Science, Software Engineering, or related field
        - 5+ years of professional software development experience
        - Strong proficiency in multiple programming languages (Python, JavaScript, Java, C++, Go, Rust)
        - Experience with system design, algorithms, and data structures
        - Familiarity with modern development practices (CI/CD, testing, code review)
        - Experience at a top tech company (FAANG, unicorn startup) preferred

        You will:
        - Evaluate AI-generated code for correctness, efficiency, and best practices
        - Write complex coding problems that test AI capabilities
        - Provide detailed feedback on code quality and architecture
        - Help develop evaluation criteria for code generation
        - Review RLHF training data for code models
      `,
      labelTypes: ['Code Review', 'Evaluation/Rating', 'Prompt + Response Writing (SFT)', 'RLHF'],
      availableCountries: ['USA', 'Canada', 'UK', 'India', 'Germany'],
      availableLanguages: ['English'],
      instructions: `
        Help improve code LLMs by evaluating generated code across multiple languages
        and domains including web development, systems programming, data science, and DevOps.
      `,
    });

    it('classifies software engineering code evaluation as specialized', () => {
      const result = classifyJob(softwareEngineeringJob);

      expect(result.jobClass).toBe('specialized');
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.requirements.minimumExperienceYears).toBeGreaterThanOrEqual(5);
    });

    it('detects software/code domain', () => {
      const result = classifyJob(softwareEngineeringJob);

      expect(result.requirements.subjectMatterCodes).toEqual(
        expect.arrayContaining(['engineering:software'])
      );
    });

    it('detects RLHF/SFT specialized label types', () => {
      const result = classifyJob(softwareEngineeringJob);

      expect(result.signals.some(s => s.includes('label_type:specialized'))).toBe(true);
    });
  });

  describe('Data Science / ML Engineer - Model Evaluation', () => {
    const dataScienceJob = createJob({
      jobId: 'ds-ml-eval-001',
      title: 'Machine Learning Engineer - AI Evaluation Specialist',
      dataSubjectMatter: 'Data Science, Machine Learning, Statistics',
      expertiseLevel: 'Expert',
      requirementsAdditional: `
        Join our elite team of ML experts evaluating frontier AI models.

        Requirements:
        - PhD in Machine Learning, Statistics, Computer Science, or related quantitative field
        - 3+ years of industry experience in ML/AI
        - Strong background in deep learning, NLP, and statistical modeling
        - Experience with PyTorch, TensorFlow, JAX
        - Published research in top ML venues (NeurIPS, ICML, ICLR) preferred
        - Experience with LLM fine-tuning, RLHF, or model evaluation

        Responsibilities:
        - Evaluate AI model outputs for statistical and mathematical correctness
        - Create challenging ML/statistics problems for model evaluation
        - Provide expert feedback on model reasoning and methodology
        - Help develop evaluation benchmarks for quantitative reasoning
      `,
      labelTypes: ['Evaluation/Rating', 'Expert Review', 'Response Assessment'],
      availableCountries: ['USA', 'Canada', 'UK'],
      availableLanguages: ['English'],
    });

    it('classifies ML evaluation job as specialized', () => {
      const result = classifyJob(dataScienceJob);

      expect(result.jobClass).toBe('specialized');
      expect(result.requirements.credentials).toEqual(expect.arrayContaining(['PHD']));
    });

    it('extracts data science domain codes', () => {
      const result = classifyJob(dataScienceJob);

      expect(result.requirements.subjectMatterCodes).toEqual(
        expect.arrayContaining(['science:data_science', 'science:ml', 'science:statistics'])
      );
    });
  });

  describe('Physics / Chemistry Expert - Scientific AI Training', () => {
    const physicsJob = createJob({
      jobId: 'physics-ai-001',
      title: 'Physics Expert - Scientific AI Training',
      dataSubjectMatter: 'Physics, Chemistry, Scientific Research',
      expertiseLevel: 'PhD Required',
      requirementsAdditional: `
        Help train AI to understand advanced physics and chemistry concepts.

        Requirements:
        - PhD in Physics, Chemistry, or related physical science
        - Active researcher or professor preferred
        - Deep expertise in quantum mechanics, thermodynamics, or materials science
        - Strong publication record
        - 5+ years post-PhD experience

        Tasks:
        - Develop graduate-level physics problems
        - Evaluate AI responses on scientific accuracy
        - Create rubrics for scientific reasoning evaluation
      `,
      labelTypes: ['Evaluation/Rating', 'Expert Review', 'Prompt Writing'],
      availableCountries: ['USA', 'UK', 'Germany', 'Canada'],
    });

    it('classifies physics expert job as specialized', () => {
      const result = classifyJob(physicsJob);

      expect(result.jobClass).toBe('specialized');
      expect(result.requirements.credentials).toEqual(expect.arrayContaining(['PHD']));
      expect(result.requirements.expertiseTier).toBe('specialist');
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

        Requirements:
        - Basic computer skills
        - Attention to detail
        - Reliable internet connection
        - No prior experience needed - we provide training

        You will:
        - Draw bounding boxes around objects in images
        - Label common objects (cars, people, animals)
        - Follow simple annotation guidelines
      `,
      labelTypes: ['Bounding Box', 'Image Classification'],
      availableCountries: ['USA', 'India', 'Philippines', 'Kenya', 'Nigeria'],
      availableLanguages: ['English'],
    });

    it('classifies basic bounding box job as generic', () => {
      const result = classifyJob(boundingBoxJob);

      expect(result.jobClass).toBe('generic');
      expect(result.requirements.credentials).toHaveLength(0);
      expect(result.requirements.expertiseTier).toBe('entry');
    });

    it('has no hard credential requirements', () => {
      const result = classifyJob(boundingBoxJob);

      expect(result.requirements.hasHardCredentialRequirement).toBeFalsy();
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

        Requirements:
        - Good typing skills (50+ WPM preferred)
        - Native or fluent English speaker
        - Good listening skills
        - Basic computer proficiency
        - No degree required
      `,
      labelTypes: ['Transcription', 'Audio Annotation'],
      availableCountries: ['USA', 'UK', 'Canada', 'Australia', 'Philippines'],
    });

    it('classifies transcription job as generic', () => {
      const result = classifyJob(transcriptionJob);

      expect(result.jobClass).toBe('generic');
      expect(result.requirements.expertiseTier).toBe('entry');
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
      const result = classifyJob(videoTaggingJob);

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
        Specialized in structural analysis, bridge design, and geotechnical engineering.

        Education:
        - PhD in Civil Engineering, Stanford University
        - MS in Structural Engineering, UC Berkeley
        - BS in Civil Engineering, Georgia Tech

        Experience:
        - Senior Structural Engineer, AECOM (2018-present)
        - Structural Engineer, Bechtel (2012-2018)

        Certifications: PE (California, Texas), LEED AP

        Published 15 peer-reviewed papers on earthquake-resistant structures.
      `,
      workExperience: [
        'Senior Structural Engineer at AECOM, specializing in bridge and building design',
        'Structural Engineer at Bechtel, working on infrastructure projects',
      ],
      education: [
        'PhD Civil Engineering, Stanford University',
        'MS Structural Engineering, UC Berkeley',
        'BS Civil Engineering, Georgia Tech',
      ],
    });

    it('classifies civil engineer as domain expert', () => {
      const result = classifyUser(civilEngineer);

      expect(result.userClass).toBe('domain_expert');
      expect(result.credentials).toEqual(expect.arrayContaining(['PE', 'PHD', 'MS', 'BS']));
      expect(result.expertiseTier).toBe('specialist');
    });

    it('extracts engineering domain codes', () => {
      const result = classifyUser(civilEngineer);

      expect(result.domainCodes).toEqual(
        expect.arrayContaining(['engineering:civil'])
      );
    });

    it('is eligible for civil engineering specialized job', () => {
      const userResult = classifyUser(civilEngineer);

      const eligible = isEligibleForSpecializedJob(
        userResult,
        ['PE', 'PHD'],
        ['engineering:civil']
      );

      expect(eligible).toBe(true);
    });

    it('should be excluded from basic bounding box jobs', () => {
      const userResult = classifyUser(civilEngineer);

      expect(shouldExcludeFromGenericJob(userResult)).toBe(true);
    });
  });

  describe('Senior Software Engineer', () => {
    const softwareEngineer = createUser({
      userId: 'swe-001',
      resumeText: `
        Senior Software Engineer with 8 years of experience at top tech companies.

        Skills: Python, JavaScript, TypeScript, Go, Rust, Java, C++
        Expertise: Distributed systems, machine learning infrastructure, API design

        Education:
        - MS Computer Science, MIT
        - BS Computer Science, Carnegie Mellon

        Experience:
        - Staff Engineer, Google (2020-present) - Tech lead for ML infrastructure
        - Senior Engineer, Meta (2017-2020) - Built recommendation systems
        - Software Engineer, Stripe (2015-2017) - Payment processing systems

        Open source contributions to TensorFlow, Kubernetes.
        3 patents in distributed computing.
      `,
      workExperience: [
        'Staff Engineer at Google, leading ML infrastructure team',
        'Senior Engineer at Meta, building recommendation systems',
        'Software Engineer at Stripe, payment processing',
      ],
      education: [
        'MS Computer Science, MIT',
        'BS Computer Science, Carnegie Mellon',
      ],
    });

    it('classifies software engineer as domain expert', () => {
      const result = classifyUser(softwareEngineer);

      expect(result.userClass).toBe('domain_expert');
      expect(result.credentials).toEqual(expect.arrayContaining(['MS', 'BS']));
    });

    it('extracts software engineering domain', () => {
      const result = classifyUser(softwareEngineer);

      expect(result.domainCodes).toEqual(
        expect.arrayContaining(['engineering:software'])
      );
    });

    it('is eligible for code evaluation specialized job', () => {
      const userResult = classifyUser(softwareEngineer);

      const eligible = isEligibleForSpecializedJob(
        userResult,
        ['MS'],
        ['engineering:software']
      );

      expect(eligible).toBe(true);
    });
  });

  describe('ML Researcher with Labeling Experience', () => {
    const mlResearcher = createUser({
      userId: 'ml-researcher-001',
      resumeText: `
        Machine Learning Researcher and AI Trainer with expertise in NLP and LLMs.

        Education:
        - PhD in Computer Science (Machine Learning focus), Stanford University
        - MS in Statistics, Columbia University

        Research Experience:
        - Research Scientist, OpenAI (2021-present)
        - ML Researcher, DeepMind (2018-2021)

        AI Training Work:
        - RLHF data collection lead for GPT-4
        - Contributed to InstructGPT training data
        - Scale AI expert annotator for code models

        Publications: 25+ papers at NeurIPS, ICML, ACL
      `,
      workExperience: [
        'Research Scientist at OpenAI',
        'ML Researcher at DeepMind',
      ],
      education: [
        'PhD Computer Science, Stanford University',
        'MS Statistics, Columbia University',
      ],
      labelingExperience: [
        'RLHF data collection for GPT-4',
        'InstructGPT training data',
        'Scale AI code annotation',
        'Prompt engineering and response evaluation',
      ],
    });

    it('classifies ML researcher with labeling experience as mixed', () => {
      const result = classifyUser(mlResearcher);

      expect(result.userClass).toBe('mixed');
      expect(result.credentials).toEqual(expect.arrayContaining(['PHD', 'MS']));
      expect(result.hasLabelingExperience).toBe(true);
    });

    it('should NOT be excluded from generic jobs (has labeling experience)', () => {
      const result = classifyUser(mlResearcher);

      // Mixed users with labeling experience should not be excluded from generic jobs
      expect(shouldExcludeFromGenericJob(result)).toBe(false);
    });
  });

  describe('General Data Labeler', () => {
    const dataLabeler = createUser({
      userId: 'labeler-001',
      resumeText: `
        Experienced data annotator with 3 years of remote work experience.

        Platforms: Scale AI, Appen, Remotasks, Amazon MTurk

        Skills:
        - Image annotation (bounding boxes, segmentation, keypoints)
        - Audio transcription
        - Text classification
        - NER labeling

        Completed 10,000+ annotation tasks with 98% accuracy.
        Top-rated contributor on multiple platforms.
      `,
      labelingExperience: [
        'Scale AI - Image annotation, bounding boxes',
        'Appen - Audio transcription',
        'Remotasks - Object detection',
        'MTurk - Various annotation tasks',
      ],
    });

    it('classifies data labeler as general labeler', () => {
      const result = classifyUser(dataLabeler);

      expect(result.userClass).toBe('general_labeler');
      expect(result.hasLabelingExperience).toBe(true);
      expect(result.taskCapabilities.length).toBeGreaterThan(0);
    });

    it('is NOT eligible for specialized engineering job', () => {
      const result = classifyUser(dataLabeler);

      const eligible = isEligibleForSpecializedJob(
        result,
        ['PE', 'PHD'],
        ['engineering:civil']
      );

      expect(eligible).toBe(false);
    });

    it('should NOT be excluded from generic jobs', () => {
      const result = classifyUser(dataLabeler);

      expect(shouldExcludeFromGenericJob(result)).toBe(false);
    });
  });
});

describe('Cross-Domain Matching Scenarios', () => {
  it('PhD physicist is NOT eligible for civil engineering job', () => {
    const physicist = createUser({
      resumeText: 'PhD in Physics from MIT. 10 years research experience in quantum mechanics.',
      education: ['PhD Physics, MIT'],
    });

    const result = classifyUser(physicist);

    const eligible = isEligibleForSpecializedJob(
      result,
      ['PE'],
      ['engineering:civil']
    );

    expect(eligible).toBe(false);
  });

  it('Attorney is NOT eligible for medical job', () => {
    const attorney = createUser({
      resumeText: 'Corporate attorney with JD from Harvard Law. 8 years M&A experience.',
      education: ['JD, Harvard Law School'],
    });

    const result = classifyUser(attorney);

    const eligible = isEligibleForSpecializedJob(
      result,
      ['MD'],
      ['medical:general']
    );

    expect(eligible).toBe(false);
  });

  it('General labeler should be matched to generic jobs', () => {
    const labeler = createUser({
      resumeText: 'Freelance annotator working on Scale AI and Appen.',
      labelingExperience: ['Bounding box annotation', 'Image classification'],
    });

    const labelerResult = classifyUser(labeler);

    const boundingBoxJob = createJob({
      title: 'Image Annotator',
      expertiseLevel: 'Entry Level',
      labelTypes: ['Bounding Box'],
    });

    const jobResult = classifyJob(boundingBoxJob);

    expect(labelerResult.userClass).toBe('general_labeler');
    expect(jobResult.jobClass).toBe('generic');
    expect(shouldExcludeFromGenericJob(labelerResult)).toBe(false);
  });

  it('PhD engineer should NOT receive generic bounding box job', () => {
    const phdEngineer = createUser({
      resumeText: 'PhD in Electrical Engineering. Professor at Stanford. 20 years experience.',
      education: ['PhD Electrical Engineering, Stanford'],
    });

    const result = classifyUser(phdEngineer);

    expect(result.userClass).toBe('domain_expert');
    expect(shouldExcludeFromGenericJob(result)).toBe(true);
  });
});
