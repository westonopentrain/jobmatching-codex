-- Add source field to existing audit tables for sync monitoring
ALTER TABLE "audit_job_upserts" ADD COLUMN "source" TEXT;
ALTER TABLE "audit_user_upserts" ADD COLUMN "source" TEXT;

-- Create user metadata update audit table
CREATE TABLE "audit_user_metadata_updates" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT,
    "country" TEXT,
    "languages" TEXT[],
    "elapsed_ms" DOUBLE PRECISION,

    CONSTRAINT "audit_user_metadata_updates_pkey" PRIMARY KEY ("id")
);

-- Create job metadata update audit table
CREATE TABLE "audit_job_metadata_updates" (
    "id" SERIAL NOT NULL,
    "job_id" TEXT NOT NULL,
    "request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT,
    "countries" TEXT[],
    "languages" TEXT[],
    "elapsed_ms" DOUBLE PRECISION,

    CONSTRAINT "audit_job_metadata_updates_pkey" PRIMARY KEY ("id")
);

-- Create indexes for efficient querying
CREATE INDEX "audit_user_metadata_updates_user_id_idx" ON "audit_user_metadata_updates"("user_id");
CREATE INDEX "audit_user_metadata_updates_created_at_idx" ON "audit_user_metadata_updates"("created_at");
CREATE INDEX "audit_job_metadata_updates_job_id_idx" ON "audit_job_metadata_updates"("job_id");
CREATE INDEX "audit_job_metadata_updates_created_at_idx" ON "audit_job_metadata_updates"("created_at");
