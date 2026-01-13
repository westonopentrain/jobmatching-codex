import { describe, expect, it } from 'vitest';
import {
  classifyUserSync,
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

describe('classifyUserSync (fallback classification)', () => {
  describe('domain expert classification', () => {
    it('classifies MD physician as domain expert', () => {
      const profile = createUserProfile({
        resumeText:
          'Board-certified OB-GYN physician with 10 years of clinical experience. MD from Johns Hopkins University.',
        workExperience: ['OB-GYN Physician at City Hospital, 2014-present'],
        education: ['MD, Johns Hopkins University School of Medicine'],
      });

      const result = classifyUserSync(profile);

      expect(result.userClass).toBe('domain_expert');
      expect(result.hasLabelingExperience).toBe(false);
    });

    it('classifies attorney as domain expert', () => {
      const profile = createUserProfile({
        resumeText: 'Corporate attorney with 8 years experience. JD from Harvard Law School.',
        workExperience: ['Partner, Smith & Associates, 2018-present'],
        education: ['JD, Harvard Law School'],
      });

      const result = classifyUserSync(profile);

      expect(result.userClass).toBe('domain_expert');
    });

    it('classifies PhD researcher as domain expert', () => {
      const profile = createUserProfile({
        resumeText: 'PhD in Computational Biology. Research scientist at major pharmaceutical company.',
        workExperience: ['Senior Research Scientist, Pfizer, 2019-present'],
        education: ['PhD Computational Biology, MIT'],
      });

      const result = classifyUserSync(profile);

      expect(result.userClass).toBe('domain_expert');
    });

    it('classifies engineer as domain expert', () => {
      const profile = createUserProfile({
        resumeText: 'Senior software engineer with 10 years experience at Google.',
        workExperience: ['Senior Engineer, Google, 2014-present'],
      });

      const result = classifyUserSync(profile);

      expect(result.userClass).toBe('domain_expert');
    });
  });

  describe('general labeler classification', () => {
    it('classifies data labeler with platform experience', () => {
      const profile = createUserProfile({
        resumeText: 'Experienced data annotator with 2 years of experience.',
        workExperience: ['Data Labeler at Scale AI, 2022-present', 'Annotator at Appen, 2021-2022'],
        labelingExperience: ['Bounding box annotation', 'Image classification'],
      });

      const result = classifyUserSync(profile);

      expect(result.userClass).toBe('general_labeler');
      expect(result.hasLabelingExperience).toBe(true);
    });

    it('classifies transcriptionist as general labeler', () => {
      const profile = createUserProfile({
        resumeText: 'Professional transcriptionist with excellent typing skills.',
        workExperience: ['Freelance Transcriptionist, 2020-present'],
        labelingExperience: ['Audio transcription', 'Video transcription'],
      });

      const result = classifyUserSync(profile);

      expect(result.userClass).toBe('general_labeler');
      expect(result.hasLabelingExperience).toBe(true);
    });

    it('classifies user with MTurk experience as general labeler', () => {
      const profile = createUserProfile({
        resumeText: 'Completed over 5000 HITs on Amazon Mechanical Turk. Experienced with various annotation tasks.',
        workExperience: ['MTurk Worker, 2019-present'],
      });

      const result = classifyUserSync(profile);

      expect(result.userClass).toBe('general_labeler');
      expect(result.hasLabelingExperience).toBe(true);
    });

    it('classifies user with rater title as general labeler', () => {
      const profile = createUserProfile({
        resumeText: 'Search quality rater for major tech companies.',
        workExperience: ['Quality Rater, 2021-present'],
      });

      const result = classifyUserSync(profile);

      expect(result.userClass).toBe('general_labeler');
      expect(result.hasLabelingExperience).toBe(true);
    });
  });

  describe('mixed classification', () => {
    it('classifies physician with labeling experience as mixed', () => {
      const profile = createUserProfile({
        resumeText: 'Board-certified cardiologist. Also worked as a medical content reviewer at Scale AI.',
        workExperience: ['Cardiologist, Heart Center, 2010-present', 'Medical Reviewer, Scale AI, 2022-present'],
        education: ['MD, Stanford University'],
        labelingExperience: ['Medical content evaluation', 'RLHF rating'],
      });

      const result = classifyUserSync(profile);

      expect(result.userClass).toBe('mixed');
      expect(result.hasLabelingExperience).toBe(true);
    });

    it('classifies engineer with annotation experience as mixed', () => {
      const profile = createUserProfile({
        resumeText: 'Senior software engineer. Also work as a code annotator for AI model training.',
        workExperience: ['Senior Engineer, Google, 2018-present'],
        labelingExperience: ['Code review', 'Code annotation'],
      });

      const result = classifyUserSync(profile);

      expect(result.userClass).toBe('mixed');
      expect(result.hasLabelingExperience).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles empty profile', () => {
      const profile = createUserProfile({
        resumeText: '',
      });

      const result = classifyUserSync(profile);

      expect(result.userClass).toBe('general_labeler');
      expect(result.confidence).toBe(0.5);
    });

    it('handles profile with no strong signals', () => {
      const profile = createUserProfile({
        resumeText: 'Looking for work opportunities.',
      });

      const result = classifyUserSync(profile);

      expect(result.userClass).toBe('general_labeler');
    });

    it('detects labeling experience from explicit field', () => {
      const profile = createUserProfile({
        resumeText: 'Recent college graduate looking for annotation work.',
        labelingExperience: ['Image labeling for self-driving cars', 'Audio transcription projects'],
      });

      const result = classifyUserSync(profile);

      expect(result.hasLabelingExperience).toBe(true);
    });
  });
});

describe('isEligibleForSpecializedJob', () => {
  it('returns true for domain expert with matching credentials', () => {
    const classification = classifyUserSync(
      createUserProfile({
        resumeText: 'Board-certified OB-GYN physician with MD degree.',
        education: ['MD, Stanford University'],
      })
    );
    // Override credentials for test since fallback doesn't extract them
    classification.credentials = ['MD'];
    classification.domainCodes = ['medical:obgyn'];

    const eligible = isEligibleForSpecializedJob(classification, ['MD'], ['medical:obgyn', 'medical:general']);

    expect(eligible).toBe(true);
  });

  it('returns false for general labeler on specialized job', () => {
    const classification = classifyUserSync(
      createUserProfile({
        resumeText: 'Data annotator with 2 years experience.',
        labelingExperience: ['Bounding box annotation'],
      })
    );

    const eligible = isEligibleForSpecializedJob(classification, ['MD'], ['medical:obgyn']);

    expect(eligible).toBe(false);
  });

  it('returns false for domain expert with wrong credentials', () => {
    const classification = classifyUserSync(
      createUserProfile({
        resumeText: 'Corporate attorney with JD.',
        education: ['JD, Harvard Law'],
      })
    );
    classification.credentials = ['JD'];

    const eligible = isEligibleForSpecializedJob(classification, ['MD'], ['medical:general']);

    expect(eligible).toBe(false);
  });
});

describe('shouldExcludeFromGenericJob', () => {
  it('returns true for pure domain expert without labeling experience', () => {
    const classification = classifyUserSync(
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
    const classification = classifyUserSync(
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
    const classification = classifyUserSync(
      createUserProfile({
        resumeText: 'Professional data annotator.',
        labelingExperience: ['Bounding box', 'Transcription'],
      })
    );

    const shouldExclude = shouldExcludeFromGenericJob(classification);

    expect(shouldExclude).toBe(false);
  });
});
