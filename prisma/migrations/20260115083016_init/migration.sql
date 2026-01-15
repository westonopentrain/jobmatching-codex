-- CreateTable
CREATE TABLE "audit_job_upserts" (
    "id" SERIAL NOT NULL,
    "job_id" TEXT NOT NULL,
    "request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT,
    "raw_input" JSONB,
    "domain_capsule" TEXT,
    "domain_keywords" TEXT[],
    "task_capsule" TEXT,
    "task_keywords" TEXT[],
    "job_class" TEXT,
    "classification_confidence" DOUBLE PRECISION,
    "credentials" TEXT[],
    "subject_matter_codes" TEXT[],
    "expertise_tier" TEXT,
    "classification_reasoning" TEXT,
    "elapsed_ms" INTEGER,

    CONSTRAINT "audit_job_upserts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_user_upserts" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resume_chars" INTEGER,
    "has_work_experience" BOOLEAN,
    "has_education" BOOLEAN,
    "has_labeling_experience" BOOLEAN,
    "country" TEXT,
    "languages" TEXT[],
    "domain_capsule" TEXT,
    "task_capsule" TEXT,
    "evidence_detected" BOOLEAN,
    "validation_violations" TEXT[],
    "elapsed_ms" INTEGER,

    CONSTRAINT "audit_user_upserts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_match_requests" (
    "id" SERIAL NOT NULL,
    "job_id" TEXT NOT NULL,
    "request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "candidate_count" INTEGER,
    "w_domain" DOUBLE PRECISION,
    "w_task" DOUBLE PRECISION,
    "weights_source" TEXT,
    "threshold_used" DOUBLE PRECISION,
    "top_k_used" INTEGER,
    "results_returned" INTEGER,
    "count_gte_threshold" INTEGER,
    "missing_domain_vectors" INTEGER,
    "missing_task_vectors" INTEGER,
    "elapsed_ms" INTEGER,

    CONSTRAINT "audit_match_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_match_results" (
    "id" SERIAL NOT NULL,
    "match_request_id" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "s_domain" DOUBLE PRECISION,
    "s_task" DOUBLE PRECISION,
    "final_score" DOUBLE PRECISION,
    "rank" INTEGER,

    CONSTRAINT "audit_match_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_ground_truth" (
    "id" SERIAL NOT NULL,
    "job_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT,

    CONSTRAINT "evaluation_ground_truth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_job_upserts_job_id_idx" ON "audit_job_upserts"("job_id");

-- CreateIndex
CREATE INDEX "audit_job_upserts_created_at_idx" ON "audit_job_upserts"("created_at");

-- CreateIndex
CREATE INDEX "audit_user_upserts_user_id_idx" ON "audit_user_upserts"("user_id");

-- CreateIndex
CREATE INDEX "audit_user_upserts_created_at_idx" ON "audit_user_upserts"("created_at");

-- CreateIndex
CREATE INDEX "audit_match_requests_job_id_idx" ON "audit_match_requests"("job_id");

-- CreateIndex
CREATE INDEX "audit_match_requests_created_at_idx" ON "audit_match_requests"("created_at");

-- CreateIndex
CREATE INDEX "audit_match_results_match_request_id_idx" ON "audit_match_results"("match_request_id");

-- CreateIndex
CREATE INDEX "audit_match_results_user_id_idx" ON "audit_match_results"("user_id");

-- CreateIndex
CREATE INDEX "evaluation_ground_truth_job_id_idx" ON "evaluation_ground_truth"("job_id");

-- CreateIndex
CREATE INDEX "evaluation_ground_truth_user_id_idx" ON "evaluation_ground_truth"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_ground_truth_job_id_user_id_key" ON "evaluation_ground_truth"("job_id", "user_id");

-- AddForeignKey
ALTER TABLE "audit_match_results" ADD CONSTRAINT "audit_match_results_match_request_id_fkey" FOREIGN KEY ("match_request_id") REFERENCES "audit_match_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
