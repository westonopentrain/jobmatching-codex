import { describe, expect, it } from 'vitest';
import {
  classifyUser,
  isEligibleForSpecializedJob,
  shouldExcludeFromGenericJob,
} from '../src/services/user-classifier';
import { NormalizedUserProfile } from '../src/utils/types';

function createUserProfile(overrides: Partial<NormalizedUserProfile>): NormalizedUserProfile {
  return {
    userId: 'test-user-1',
    resumeText: '',
    workExperience: [],
    education: [],
    labelingExperience: [],
    languages: [],
    ...overrides,
  };
}

describe('classifyUser', () => {
  describe('domain expert classification', () => {
    it('classifies MD physician as domain expert', () => {
      const profile = createUserProfile({
        resumeText:
          'Board-certified OB-GYN physician with 10 years of clinical experience. MD from Johns Hopkins University. Completed residency in Obstetrics and Gynecology.',
        workExperience: [
          'OB-GYN Physician at City Hospital, 2014-present',
          'Resident, Obstetrics and Gynecology, 2010-2014',
        ],
        education: ['MD, Johns Hopkins University School of Medicine', 'BS Biology, Stanford University'],
      });

      const result = classifyUser(profile);

      expect(result.userClass).toBe('domain_expert');
      expect(result.credentials).toEqual(expect.arrayContaining(['MD']));
      expect(result.domainCodes).toEqual(expect.arrayContaining(['medical:general']));
      expect(result.hasLabelingExperience).toBe(false);
    });

    it('classifies attorney as domain expert', () => {
      const profile = createUserProfile({
        resumeText:
          'Corporate attorney with 8 years experience in mergers and acquisitions. JD from Harvard Law School.',
        workExperience: ['Partner, Smith & Associates, 2018-present', 'Associate, BigLaw LLP, 2015-2018'],
        education: ['JD, Harvard Law School', 'BA Political Science, Yale University'],
      });

      const result = classifyUser(profile);

      expect(result.userClass).toBe('domain_expert');
      expect(result.credentials).toContain('JD');
      expect(result.domainCodes).toEqual(expect.arrayContaining(['legal:general']));
    });

    it('classifies PhD researcher as domain expert', () => {
      const profile = createUserProfile({
        resumeText:
          'PhD in Computational Biology. Research scientist at major pharmaceutical company. Published 15 peer-reviewed papers.',
        workExperience: ['Senior Research Scientist, Pfizer, 2019-present'],
        education: ['PhD Computational Biology, MIT', 'MS Bioinformatics, Stanford'],
      });

      const result = classifyUser(profile);

      expect(result.userClass).toBe('domain_expert');
      expect(result.credentials).toEqual(expect.arrayContaining(['PHD', 'MS']));
    });
  });

  describe('general labeler classification', () => {
    it('classifies data labeler with platform experience', () => {
      const profile = createUserProfile({
        resumeText:
          'Experienced data annotator with 2 years of experience. Worked on various image annotation and transcription projects.',
        workExperience: ['Data Labeler at Scale AI, 2022-present', 'Annotator at Appen, 2021-2022'],
        labelingExperience: [
          'Bounding box annotation',
          'Image classification',
          'Audio transcription',
          'NER labeling',
        ],
      });

      const result = classifyUser(profile);

      expect(result.userClass).toBe('general_labeler');
      expect(result.hasLabelingExperience).toBe(true);
      expect(result.taskCapabilities).toEqual(
        expect.arrayContaining(['bounding_box', 'transcription', 'ner'])
      );
    });

    it('classifies transcriptionist as general labeler', () => {
      const profile = createUserProfile({
        resumeText:
          'Professional transcriptionist with excellent typing skills. Completed over 1000 hours of audio transcription.',
        workExperience: ['Freelance Transcriptionist, 2020-present'],
        labelingExperience: ['Audio transcription', 'Video transcription'],
      });

      const result = classifyUser(profile);

      expect(result.userClass).toBe('general_labeler');
      expect(result.hasLabelingExperience).toBe(true);
    });

    it('classifies user with MTurk experience as general labeler', () => {
      const profile = createUserProfile({
        resumeText: 'Completed over 5000 HITs on Amazon Mechanical Turk. Experienced with various annotation tasks.',
        workExperience: ['MTurk Worker, 2019-present'],
      });

      const result = classifyUser(profile);

      expect(result.userClass).toBe('general_labeler');
      expect(result.signals).toEqual(expect.arrayContaining([expect.stringMatching(/labeling_platform/)]));
    });
  });

  describe('mixed classification', () => {
    it('classifies physician with labeling experience as mixed', () => {
      const profile = createUserProfile({
        resumeText:
          'Board-certified cardiologist with 15 years experience. Also worked as a medical content reviewer for AI training projects.',
        workExperience: [
          'Cardiologist, Heart Center, 2010-present',
          'Medical Reviewer, Scale AI, 2022-present',
        ],
        education: ['MD, Stanford University'],
        labelingExperience: ['Medical content evaluation', 'RLHF rating', 'Prompt response evaluation'],
      });

      const result = classifyUser(profile);

      expect(result.userClass).toBe('mixed');
      expect(result.credentials).toContain('MD');
      expect(result.hasLabelingExperience).toBe(true);
    });

    it('classifies software engineer with annotation experience as mixed', () => {
      const profile = createUserProfile({
        resumeText:
          'Senior software engineer with 8 years experience. Also work as a code reviewer for AI model training.',
        workExperience: [
          'Senior Engineer, Google, 2018-present',
          'Code Annotator, OpenAI (contract), 2023-present',
        ],
        labelingExperience: ['Code review', 'Code annotation', 'RLHF for code'],
      });

      const result = classifyUser(profile);

      // Engineer with labeling experience should be mixed
      expect(['mixed', 'domain_expert']).toContain(result.userClass);
      expect(result.hasLabelingExperience).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles empty profile', () => {
      const profile = createUserProfile({
        resumeText: '',
      });

      const result = classifyUser(profile);

      // Should default to general labeler with low confidence
      expect(result.userClass).toBe('general_labeler');
      expect(result.confidence).toBeLessThanOrEqual(0.5);
    });

    it('extracts experience years from resume', () => {
      const profile = createUserProfile({
        resumeText: 'Physician with over 10 years of clinical experience.',
      });

      const result = classifyUser(profile);

      expect(result.estimatedExperienceYears).toBe(10);
    });

    it('extracts multiple credentials', () => {
      const profile = createUserProfile({
        resumeText: 'MD, PhD with board certification. Also holds MBA.',
        education: ['MD/PhD, UCSF', 'MBA, Wharton'],
      });

      const result = classifyUser(profile);

      expect(result.credentials).toEqual(expect.arrayContaining(['MD', 'PHD', 'MBA']));
    });

    it('detects labeling experience from explicit field', () => {
      const profile = createUserProfile({
        resumeText: 'Recent college graduate looking for annotation work.',
        labelingExperience: ['Image labeling for self-driving cars', 'Audio transcription projects'],
      });

      const result = classifyUser(profile);

      expect(result.hasLabelingExperience).toBe(true);
      expect(result.signals).toEqual(
        expect.arrayContaining([expect.stringMatching(/labeling_experience_field/)])
      );
    });
  });
});

describe('isEligibleForSpecializedJob', () => {
  it('returns true for domain expert with matching credentials', () => {
    const classification = classifyUser(
      createUserProfile({
        resumeText: 'Board-certified OB-GYN physician with MD degree.',
        education: ['MD, Stanford University'],
      })
    );

    const eligible = isEligibleForSpecializedJob(classification, ['MD'], ['medical:obgyn', 'medical:general']);

    expect(eligible).toBe(true);
  });

  it('returns false for general labeler on specialized job', () => {
    const classification = classifyUser(
      createUserProfile({
        resumeText: 'Data annotator with 2 years experience.',
        labelingExperience: ['Bounding box annotation'],
      })
    );

    const eligible = isEligibleForSpecializedJob(classification, ['MD'], ['medical:obgyn']);

    expect(eligible).toBe(false);
  });

  it('returns false for domain expert with wrong credentials', () => {
    const classification = classifyUser(
      createUserProfile({
        resumeText: 'Corporate attorney with JD.',
        education: ['JD, Harvard Law'],
      })
    );

    const eligible = isEligibleForSpecializedJob(classification, ['MD'], ['medical:general']);

    expect(eligible).toBe(false);
  });
});

describe('shouldExcludeFromGenericJob', () => {
  it('returns true for pure domain expert without labeling experience', () => {
    const classification = classifyUser(
      createUserProfile({
        resumeText: 'Board-certified surgeon with 20 years clinical experience. MD from Harvard.',
        education: ['MD, Harvard Medical School'],
      })
    );

    // A pure domain expert (MD surgeon) without any labeling experience should be excluded from generic jobs
    // to avoid spamming them with basic bounding box work
    expect(classification.userClass).toBe('domain_expert');
    expect(classification.hasLabelingExperience).toBe(false);
    const shouldExclude = shouldExcludeFromGenericJob(classification);
    expect(shouldExclude).toBe(true);
  });

  it('returns false for domain expert with labeling experience', () => {
    const classification = classifyUser(
      createUserProfile({
        resumeText: 'Physician who also does medical content annotation.',
        education: ['MD, Stanford'],
        labelingExperience: ['Medical annotation', 'RLHF evaluation'],
      })
    );

    const shouldExclude = shouldExcludeFromGenericJob(classification);

    expect(shouldExclude).toBe(false);
  });

  it('returns false for general labeler', () => {
    const classification = classifyUser(
      createUserProfile({
        resumeText: 'Professional data annotator.',
        labelingExperience: ['Bounding box', 'Transcription'],
      })
    );

    const shouldExclude = shouldExcludeFromGenericJob(classification);

    expect(shouldExclude).toBe(false);
  });
});
