-- Add raw_input column to store original Bubble request data
ALTER TABLE "audit_user_upserts" ADD COLUMN "raw_input" JSONB;
