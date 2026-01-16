-- Add user classification columns to audit_user_upserts
ALTER TABLE "audit_user_upserts" ADD COLUMN "expertise_tier" TEXT;
ALTER TABLE "audit_user_upserts" ADD COLUMN "credentials" TEXT[] DEFAULT '{}';
ALTER TABLE "audit_user_upserts" ADD COLUMN "subject_matter_codes" TEXT[] DEFAULT '{}';
ALTER TABLE "audit_user_upserts" ADD COLUMN "years_experience" INTEGER;
ALTER TABLE "audit_user_upserts" ADD COLUMN "classification_confidence" DOUBLE PRECISION;
