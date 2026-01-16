export type Section = 'domain' | 'task';

export interface UpsertUserRequest {
  user_id: string;
  resume_text: string;
  work_experience?: string[];
  education?: string[];
  labeling_experience?: string[];
  country?: string;
  languages?: string[];
}

export interface NormalizedUserProfile {
  userId: string;
  resumeText: string;
  workExperience: string[];
  education: string[];
  labelingExperience: string[];
  country?: string;
  languages: string[];
}

export interface Capsule {
  text: string;
  keywords?: string[];
}

export interface CapsulePair {
  domain: Capsule;
  task: Capsule;
}

export interface JobFields {
  Instructions?: string;
  Workload_Desc?: string;
  Dataset_Description?: string;
  Data_SubjectMatter?: string;
  Data_Type?: string;
  LabelTypes?: string[];
  Requirements_Additional?: string;
  AvailableLanguages?: string[];
  AvailableCountries?: string[];
  ExpertiseLevel?: string;
  TimeRequirement?: string;
  ProjectType?: string;
  LabelSoftware?: string;
  AdditionalSkills?: string[];
}

export interface UpsertJobRequest {
  job_id: string;
  title?: string;
  fields: JobFields;
}

export interface NormalizedJobPosting {
  jobId: string;
  title?: string;
  instructions?: string;
  workloadDesc?: string;
  datasetDescription?: string;
  dataSubjectMatter?: string;
  dataType?: string;
  labelTypes: string[];
  requirementsAdditional?: string;
  availableLanguages: string[];
  availableCountries: string[];
  expertiseLevel?: string;
  timeRequirement?: string;
  projectType?: string;
  labelSoftware?: string;
  additionalSkills: string[];
  promptText: string;
  sourceText: string;
}

export interface UpsertResult {
  vectorId: string;
}

export interface CapsuleResponse {
  status: 'ok';
  user_id: string;
  embedding_model: string;
  dimension: number;
  domain: {
    vector_id: string;
    capsule_text: string;
    chars: number;
  };
  task: {
    vector_id: string;
    capsule_text: string;
    chars: number;
  };
  updated_at: string;
}

// Classification types for job matching

export type JobClass = 'specialized' | 'generic';
export type ExpertiseTier = 'entry' | 'intermediate' | 'expert' | 'specialist';

/**
 * Metadata stored with job vectors in Pinecone.
 */
export interface JobVectorMetadata {
  job_id: string;
  section: Section;
  model: string;
  type: 'job';

  // Classification
  job_class: JobClass;

  // Requirements
  required_credentials: string[];
  subject_matter_codes: string[];
  required_experience_years: number;
  expertise_tier: ExpertiseTier;

  // Geographic/language filters
  countries: string[];
  languages: string[];
}

/**
 * Metadata stored with user vectors in Pinecone.
 */
export interface UserVectorMetadata {
  user_id: string;
  section: Section;
  model: string;
  type: 'user';

  // Classification
  expertise_tier: ExpertiseTier;
  credentials: string[];
  subject_matter_codes: string[];
  years_experience: number;
  has_labeling_experience: boolean;

  // Geographic/language
  country?: string;
  languages: string[];
}
