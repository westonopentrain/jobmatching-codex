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
}

export interface CapsulePair {
  domain: Capsule;
  task: Capsule;
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
