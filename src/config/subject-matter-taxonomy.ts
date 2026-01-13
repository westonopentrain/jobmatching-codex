/**
 * Subject matter taxonomy for domain classification.
 * Maps keywords to standardized domain codes for filtering.
 */

// Medical specialties mapping
export const MEDICAL_SPECIALTIES: Record<string, string> = {
  obgyn: 'medical:obgyn',
  'ob-gyn': 'medical:obgyn',
  'ob/gyn': 'medical:obgyn',
  obstetrics: 'medical:obgyn',
  gynecology: 'medical:obgyn',
  'obstetrics and gynecology': 'medical:obgyn',
  'maternal-fetal': 'medical:obgyn',
  'maternal fetal': 'medical:obgyn',
  cardiology: 'medical:cardiology',
  cardiac: 'medical:cardiology',
  cardiovascular: 'medical:cardiology',
  radiology: 'medical:radiology',
  radiologist: 'medical:radiology',
  oncology: 'medical:oncology',
  oncologist: 'medical:oncology',
  cancer: 'medical:oncology',
  neurology: 'medical:neurology',
  neurologist: 'medical:neurology',
  neuroscience: 'medical:neurology',
  pediatrics: 'medical:pediatrics',
  pediatric: 'medical:pediatrics',
  pediatrician: 'medical:pediatrics',
  'internal medicine': 'medical:internal_medicine',
  internist: 'medical:internal_medicine',
  surgery: 'medical:surgery',
  surgeon: 'medical:surgery',
  surgical: 'medical:surgery',
  dermatology: 'medical:dermatology',
  dermatologist: 'medical:dermatology',
  psychiatry: 'medical:psychiatry',
  psychiatrist: 'medical:psychiatry',
  'mental health': 'medical:psychiatry',
  emergency: 'medical:emergency',
  'emergency medicine': 'medical:emergency',
  anesthesiology: 'medical:anesthesiology',
  anesthesiologist: 'medical:anesthesiology',
  pathology: 'medical:pathology',
  pathologist: 'medical:pathology',
  ophthalmology: 'medical:ophthalmology',
  ophthalmologist: 'medical:ophthalmology',
  orthopedics: 'medical:orthopedics',
  orthopedic: 'medical:orthopedics',
  orthopedist: 'medical:orthopedics',
  urology: 'medical:urology',
  urologist: 'medical:urology',
  nephrology: 'medical:nephrology',
  nephrologist: 'medical:nephrology',
  gastroenterology: 'medical:gastroenterology',
  gastroenterologist: 'medical:gastroenterology',
  pulmonology: 'medical:pulmonology',
  pulmonologist: 'medical:pulmonology',
  rheumatology: 'medical:rheumatology',
  rheumatologist: 'medical:rheumatology',
  endocrinology: 'medical:endocrinology',
  endocrinologist: 'medical:endocrinology',
  'infectious disease': 'medical:infectious_disease',
  hematology: 'medical:hematology',
  hematologist: 'medical:hematology',
  nursing: 'medical:nursing',
  nurse: 'medical:nursing',
  pharmacy: 'medical:pharmacy',
  pharmacist: 'medical:pharmacy',
  dentistry: 'medical:dentistry',
  dental: 'medical:dentistry',
  dentist: 'medical:dentistry',
  veterinary: 'medical:veterinary',
  veterinarian: 'medical:veterinary',
};

// Legal specialties mapping
export const LEGAL_SPECIALTIES: Record<string, string> = {
  legal: 'legal:general',
  law: 'legal:general',
  attorney: 'legal:general',
  lawyer: 'legal:general',
  'corporate law': 'legal:corporate',
  'corporate legal': 'legal:corporate',
  'mergers and acquisitions': 'legal:corporate',
  'm&a': 'legal:corporate',
  litigation: 'legal:litigation',
  litigator: 'legal:litigation',
  'intellectual property': 'legal:ip',
  ip: 'legal:ip',
  patent: 'legal:ip',
  trademark: 'legal:ip',
  copyright: 'legal:ip',
  'criminal law': 'legal:criminal',
  'criminal defense': 'legal:criminal',
  'family law': 'legal:family',
  divorce: 'legal:family',
  custody: 'legal:family',
  immigration: 'legal:immigration',
  'immigration law': 'legal:immigration',
  'real estate law': 'legal:real_estate',
  'property law': 'legal:real_estate',
  'tax law': 'legal:tax',
  'employment law': 'legal:employment',
  'labor law': 'legal:employment',
  contracts: 'legal:contracts',
  'contract law': 'legal:contracts',
  compliance: 'legal:compliance',
  regulatory: 'legal:compliance',
};

// Finance specialties mapping
export const FINANCE_SPECIALTIES: Record<string, string> = {
  finance: 'finance:general',
  financial: 'finance:general',
  accounting: 'finance:accounting',
  accountant: 'finance:accounting',
  bookkeeping: 'finance:accounting',
  investment: 'finance:investment',
  'investment banking': 'finance:investment',
  'asset management': 'finance:investment',
  banking: 'finance:banking',
  banker: 'finance:banking',
  insurance: 'finance:insurance',
  actuary: 'finance:insurance',
  actuarial: 'finance:insurance',
  tax: 'finance:tax',
  taxation: 'finance:tax',
  audit: 'finance:audit',
  auditor: 'finance:audit',
  auditing: 'finance:audit',
  'wealth management': 'finance:wealth',
  'financial planning': 'finance:wealth',
  'private equity': 'finance:investment',
  'venture capital': 'finance:investment',
  trading: 'finance:trading',
  trader: 'finance:trading',
};

// Engineering specialties mapping
export const ENGINEERING_SPECIALTIES: Record<string, string> = {
  engineering: 'engineering:general',
  engineer: 'engineering:general',
  software: 'engineering:software',
  'software engineering': 'engineering:software',
  'software development': 'engineering:software',
  programming: 'engineering:software',
  developer: 'engineering:software',
  mechanical: 'engineering:mechanical',
  'mechanical engineering': 'engineering:mechanical',
  electrical: 'engineering:electrical',
  'electrical engineering': 'engineering:electrical',
  electronics: 'engineering:electrical',
  civil: 'engineering:civil',
  'civil engineering': 'engineering:civil',
  structural: 'engineering:civil',
  chemical: 'engineering:chemical',
  'chemical engineering': 'engineering:chemical',
  biomedical: 'engineering:biomedical',
  'biomedical engineering': 'engineering:biomedical',
  aerospace: 'engineering:aerospace',
  'aerospace engineering': 'engineering:aerospace',
  automotive: 'engineering:automotive',
  'automotive engineering': 'engineering:automotive',
  industrial: 'engineering:industrial',
  'industrial engineering': 'engineering:industrial',
  environmental: 'engineering:environmental',
  'environmental engineering': 'engineering:environmental',
};

// Science specialties mapping
export const SCIENCE_SPECIALTIES: Record<string, string> = {
  science: 'science:general',
  scientific: 'science:general',
  research: 'science:research',
  researcher: 'science:research',
  biology: 'science:biology',
  biologist: 'science:biology',
  biological: 'science:biology',
  chemistry: 'science:chemistry',
  chemist: 'science:chemistry',
  physics: 'science:physics',
  physicist: 'science:physics',
  mathematics: 'science:mathematics',
  mathematician: 'science:mathematics',
  statistics: 'science:statistics',
  statistician: 'science:statistics',
  'data science': 'science:data_science',
  'data scientist': 'science:data_science',
  'machine learning': 'science:ml',
  'artificial intelligence': 'science:ai',
  ai: 'science:ai',
  ml: 'science:ml',
  genomics: 'science:genomics',
  genetics: 'science:genetics',
  biochemistry: 'science:biochemistry',
  microbiology: 'science:microbiology',
  neuroscience: 'science:neuroscience',
  psychology: 'science:psychology',
  psychologist: 'science:psychology',
};

// Education specialties mapping
export const EDUCATION_SPECIALTIES: Record<string, string> = {
  education: 'education:general',
  teaching: 'education:general',
  teacher: 'education:general',
  professor: 'education:higher_ed',
  academia: 'education:higher_ed',
  academic: 'education:higher_ed',
  'higher education': 'education:higher_ed',
  'k-12': 'education:k12',
  elementary: 'education:k12',
  'high school': 'education:k12',
  curriculum: 'education:curriculum',
  'instructional design': 'education:curriculum',
};

// Combined taxonomy for all domains
export const SUBJECT_MATTER_TAXONOMY: Record<string, string> = {
  ...MEDICAL_SPECIALTIES,
  ...LEGAL_SPECIALTIES,
  ...FINANCE_SPECIALTIES,
  ...ENGINEERING_SPECIALTIES,
  ...SCIENCE_SPECIALTIES,
  ...EDUCATION_SPECIALTIES,
};

// Credential to domain mapping
export const CREDENTIAL_DOMAIN_MAP: Record<string, string[]> = {
  MD: ['medical:general'],
  DO: ['medical:general'],
  MRCOG: ['medical:obgyn'],
  ABOG: ['medical:obgyn'],
  FACS: ['medical:surgery'],
  FACC: ['medical:cardiology'],
  RN: ['medical:nursing'],
  NP: ['medical:nursing'],
  BSN: ['medical:nursing'],
  MSN: ['medical:nursing'],
  PA: ['medical:general'],
  DDS: ['medical:dentistry'],
  DMD: ['medical:dentistry'],
  DVM: ['medical:veterinary'],
  PharmD: ['medical:pharmacy'],
  JD: ['legal:general'],
  LLB: ['legal:general'],
  LLM: ['legal:general'],
  CPA: ['finance:accounting'],
  CFA: ['finance:investment'],
  CFP: ['finance:wealth'],
  CMA: ['finance:accounting'],
  FRM: ['finance:risk'],
  PE: ['engineering:general'],
  PhD: [], // Domain depends on specialty - needs context
  'Ph.D': [],
  MBA: ['business:general'],
  MPH: ['medical:public_health'],
};

// Advanced credentials that indicate domain expertise
export const ADVANCED_CREDENTIALS = new Set([
  'MD',
  'DO',
  'PhD',
  'Ph.D',
  'JD',
  'DDS',
  'DMD',
  'DVM',
  'PharmD',
  'MRCOG',
  'ABOG',
  'FACS',
  'FACC',
]);

// Mid-level credentials
export const MID_CREDENTIALS = new Set([
  'RN',
  'NP',
  'PA',
  'CPA',
  'CFA',
  'CFP',
  'PE',
  'MBA',
  'MPH',
  'MSN',
  'MS',
  'MA',
]);

// Specialized domains that require credentials (for job classification)
export const SPECIALIZED_DOMAINS = new Set([
  'medical:obgyn',
  'medical:cardiology',
  'medical:radiology',
  'medical:oncology',
  'medical:neurology',
  'medical:surgery',
  'medical:anesthesiology',
  'medical:pathology',
  'medical:psychiatry',
  'medical:ophthalmology',
  'medical:orthopedics',
  'medical:emergency',
  'medical:internal_medicine',
  'medical:pediatrics',
  'medical:dermatology',
  'medical:urology',
  'medical:nephrology',
  'medical:gastroenterology',
  'medical:pulmonology',
  'medical:rheumatology',
  'medical:endocrinology',
  'medical:infectious_disease',
  'medical:hematology',
  'legal:corporate',
  'legal:litigation',
  'legal:ip',
  'legal:tax',
  'finance:investment',
  'finance:audit',
]);

// Generic task types (for job classification)
export const GENERIC_TASK_TYPES = new Set([
  'bounding box',
  'bbox',
  'bounding boxes',
  'image classification',
  'basic annotation',
  'simple annotation',
  'data collection',
  'transcription',
  'audio transcription',
  'basic labeling',
  'tagging',
  'image tagging',
  'video tagging',
  'keypoint annotation',
  'polygon annotation',
  'segmentation',
]);

/**
 * Map subject matter text to standardized domain codes.
 */
export function mapToSubjectMatterCodes(subjectMatter?: string): string[] {
  if (!subjectMatter) return [];

  const codes: string[] = [];
  const lower = subjectMatter.toLowerCase();

  // Check each taxonomy entry
  for (const [keyword, code] of Object.entries(SUBJECT_MATTER_TAXONOMY)) {
    if (lower.includes(keyword)) {
      if (!codes.includes(code)) {
        codes.push(code);
      }
    }
  }

  // Add parent domain codes for hierarchy
  const parentDomains = new Set<string>();
  for (const code of codes) {
    const [domain] = code.split(':');
    if (domain) {
      parentDomains.add(`${domain}:general`);
    }
  }

  for (const parent of parentDomains) {
    if (!codes.includes(parent)) {
      codes.push(parent);
    }
  }

  return codes;
}

/**
 * Check if a domain code represents a specialized field requiring credentials.
 */
export function isSpecializedDomain(domainCode: string): boolean {
  return SPECIALIZED_DOMAINS.has(domainCode);
}

/**
 * Get domain codes associated with a credential.
 */
export function getDomainsForCredential(credential: string): string[] {
  const upper = credential.toUpperCase();
  return CREDENTIAL_DOMAIN_MAP[upper] ?? CREDENTIAL_DOMAIN_MAP[credential] ?? [];
}
