import { describe, expect, it } from 'vitest';

import { validateJobDomainCapsule, validateJobTaskCapsule } from '../src/services/job-validate';
import { NormalizedJobPosting } from '../src/utils/types';

const baseJob: NormalizedJobPosting = {
  jobId: 'j_test',
  title: 'OBGYN Doctors - LLM Training',
  instructions: 'Review obstetrics and gynecology medical data.',
  workloadDesc: '20 hours per week',
  datasetDescription: 'Clinical question and answer dataset for obstetrics and gynecology.',
  dataSubjectMatter: 'OBGYN medicine, maternal-fetal medicine, gynecologic oncology',
  dataType: 'text',
  labelTypes: ['evaluation', 'prompt+response'],
  requirementsAdditional: 'Must be licensed OB-GYN with 5+ years experience',
  availableLanguages: ['English'],
  availableCountries: ['US'],
  expertiseLevel: 'senior',
  timeRequirement: '15-20 hours/wk',
  projectType: 'ongoing',
  labelSoftware: 'Label Studio',
  additionalSkills: ['Clinical terminology expertise'],
  promptText:
    'Title: OBGYN Doctors - LLM Training\nInstructions: Review obstetrics and gynecology medical data.\nDataset_Description: Clinical question and answer dataset for obstetrics and gynecology.\nData_SubjectMatter: OBGYN medicine, maternal-fetal medicine, gynecologic oncology\nData_Type: text\nLabelTypes: evaluation; prompt+response\nRequirements_Additional: Must be licensed OB-GYN with 5+ years experience\nAvailableLanguages: English\nAvailableCountries: US\nExpertiseLevel: senior\nTimeRequirement: 15-20 hours/wk\nProjectType: ongoing\nLabelSoftware: Label Studio\nAdditionalSkills: Clinical terminology expertise',
  sourceText:
    'OBGYN Doctors - LLM Training\nReview obstetrics and gynecology medical data.\nClinical question and answer dataset for obstetrics and gynecology.\nOBGYN medicine, maternal-fetal medicine, gynecologic oncology\ntext\nevaluation; prompt+response\nMust be licensed OB-GYN with 5+ years experience\nEnglish\nUS\nsenior\n15-20 hours/wk\nongoing\nLabel Studio\nClinical terminology expertise',
};

describe('validateJobDomainCapsule', () => {
  it('flags AI terms for rewrite', () => {
    const capsule = `OB-GYN medicine coverage including obstetrics, gynecology, maternal-fetal medicine, gynecologic oncology, clinical question review, evaluation rubric expertise, prompt+response comprehension, English-language terminology focus, clinical terminology expertise, Label Studio workflows.
Keywords: OB-GYN, obstetrics, gynecology, maternal-fetal medicine, gynecologic oncology, clinical question, evaluation, prompt+response, clinical terminology expertise, Label Studio`;

    const result = validateJobDomainCapsule(capsule, baseJob);
    expect(result.needsDomainReprompt).toBe(true);
  });

  it('throws when keywords missing from job text', () => {
    const capsule = `Obstetrics and gynecology coverage referencing prenatal diagnostics and gynecologic oncology, maternal-fetal medicine, reproductive endocrinology, pelvic floor disorders, perinatal genetics, fetal ultrasound, postpartum care, neonatal intensive care collaboration, obstetric anesthesia considerations.
Keywords: obstetrics, gynecology, prenatal diagnostics, gynecologic oncology, maternal-fetal medicine, reproductive endocrinology, pelvic floor disorders, perinatal genetics, fetal ultrasound, postpartum care, neonatal intensive care, fictitious keyword`;

    try {
      validateJobDomainCapsule(capsule, baseJob);
      throw new Error('Expected validation to throw');
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      expect(error.message).toMatch(/keywords must appear/i);
      const appError = error as Error & { details?: { context?: string } };
      expect(appError.details?.context).toBe('domain');
    }
  });

  it('allows multi-word keywords when a majority of tokens appear in job text', () => {
    const capsule = `Expert clinicians in obstetrics and gynecology provide capsule summaries covering maternal-fetal medicine, gynecologic oncology, perinatal genetics, prenatal screening programs, postpartum recovery support, and English fluency expectations for collaborating physicians while fostering clinical collaboration among specialists.
Keywords: obstetrics, gynecology, maternal-fetal medicine, gynecologic oncology, perinatal genetics, postpartum recovery, English fluency, prenatal screening, clinical collaboration, obstetric specialists`;

    const keywordRichJob: NormalizedJobPosting = {
      jobId: 'j_keywords',
      promptText: 'Job text',
      sourceText:
        'obstetrics gynecology maternal fetal medicine gynecologic oncology perinatal genetics postpartum recovery prenatal screening clinical collaboration obstetric specialists English communication',
      labelTypes: [],
      availableLanguages: [],
      availableCountries: [],
      additionalSkills: [],
    };

    expect(() => validateJobDomainCapsule(capsule, keywordRichJob)).not.toThrow();
  });
});

describe('validateJobTaskCapsule', () => {
  it('flags non-AI duties for rewrite', () => {
    const capsule = `Physicians deliver patient care while also preparing evaluation scoring for obstetrics prompt+response transcripts, reviewing clinical question text data, and verifying rubric adherence inside Label Studio projects. Responsibilities include clinical consultation, patient care follow-ups, and structured scoring of responses to gynecology prompts, maintaining accuracy thresholds and double-check workflows for OB-GYN reviewers working in English at the senior level.
Keywords: obstetrics, gynecology, clinical question, prompt+response, evaluation, Label Studio, OB-GYN, English, senior, text`;

    const result = validateJobTaskCapsule(capsule, baseJob);
    expect(result.needsTaskReprompt).toBe(true);
  });

  it('throws when keyword count invalid', () => {
    const capsule = `Experts assess obstetric prompt-response datasets, grade maternal health counseling outputs, review gynecologic oncology question answering, and evaluate rubric-driven scoring for obstetrics. They apply obstetric terminology taxonomies, ensure evidence-grounded rationales, and maintain calibration logs for long-form case narratives.
Keywords: obstetric prompts, maternal health, gynecologic oncology, rubric-driven scoring, terminology taxonomies, evidence-grounded rationales`;

    expect(() => validateJobTaskCapsule(capsule, baseJob)).toThrowError(/between 10 and 20/);
  });

  it('throws keyword alignment error with task context', () => {
    const capsule = `Clinicians annotate obstetrics chatbot prompts, grade gynecology responses, audit evaluation rubrics, and document calibration findings for maternal health datasets. They cross-check obstetric terminology, review fetal care case narratives, and finalize benchmark scoring criteria for obstetrics question answering.
Keywords: obstetrics, gynecology, annotations, calibration, evaluation rubrics, benchmark scoring, fetal care, maternal health, obstetric terminology, obstetrics qa, fictitious keyword`;

    try {
      validateJobTaskCapsule(capsule, baseJob);
      throw new Error('Expected validation to throw');
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      expect(error.message).toMatch(/keywords must appear/i);
      const appError = error as Error & { details?: { context?: string } };
      expect(appError.details?.context).toBe('task');
    }
  });
});
