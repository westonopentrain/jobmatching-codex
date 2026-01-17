-- CreateTable: User match requests (recommendations)
CREATE TABLE "audit_user_match_requests" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "job_count" INTEGER,
    "weights_source" TEXT,
    "threshold_used" DOUBLE PRECISION,
    "top_k_used" INTEGER,
    "results_returned" INTEGER,
    "count_gte_threshold" INTEGER,
    "missing_domain_vectors" INTEGER,
    "missing_task_vectors" INTEGER,
    "user_expertise_tier" TEXT,
    "suggested_threshold" DOUBLE PRECISION,
    "suggested_threshold_method" TEXT,
    "elapsed_ms" INTEGER,

    CONSTRAINT "audit_user_match_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable: User match results (job scores for user)
CREATE TABLE "audit_user_match_results" (
    "id" SERIAL NOT NULL,
    "match_request_id" INTEGER NOT NULL,
    "job_id" TEXT NOT NULL,
    "job_class" TEXT,
    "w_domain" DOUBLE PRECISION,
    "w_task" DOUBLE PRECISION,
    "s_domain" DOUBLE PRECISION,
    "s_task" DOUBLE PRECISION,
    "final_score" DOUBLE PRECISION NOT NULL,
    "rank" INTEGER NOT NULL,
    "job_threshold" DOUBLE PRECISION,
    "above_threshold" BOOLEAN,

    CONSTRAINT "audit_user_match_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Job notification audit
CREATE TABLE "audit_job_notify" (
    "id" SERIAL NOT NULL,
    "job_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT,
    "job_class" TEXT,
    "countries_filter" TEXT[],
    "languages_filter" TEXT[],
    "max_notifications" INTEGER NOT NULL,
    "total_candidates" INTEGER NOT NULL,
    "total_above_threshold" INTEGER NOT NULL,
    "notify_count" INTEGER NOT NULL,
    "threshold_specialized" DOUBLE PRECISION NOT NULL,
    "threshold_generic" DOUBLE PRECISION NOT NULL,
    "score_min" DOUBLE PRECISION,
    "score_max" DOUBLE PRECISION,
    "elapsed_ms" INTEGER,

    CONSTRAINT "audit_job_notify_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Job notification user results
CREATE TABLE "audit_job_notify_results" (
    "id" SERIAL NOT NULL,
    "notify_request_id" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_country" TEXT,
    "user_languages" TEXT[],
    "expertise_tier" TEXT,
    "domain_score" DOUBLE PRECISION NOT NULL,
    "task_score" DOUBLE PRECISION NOT NULL,
    "final_score" DOUBLE PRECISION NOT NULL,
    "threshold_used" DOUBLE PRECISION NOT NULL,
    "notified" BOOLEAN NOT NULL,
    "filter_reason" TEXT,
    "rank" INTEGER,

    CONSTRAINT "audit_job_notify_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: User match requests
CREATE INDEX "audit_user_match_requests_user_id_idx" ON "audit_user_match_requests"("user_id");
CREATE INDEX "audit_user_match_requests_created_at_idx" ON "audit_user_match_requests"("created_at");

-- CreateIndex: User match results
CREATE INDEX "audit_user_match_results_match_request_id_idx" ON "audit_user_match_results"("match_request_id");
CREATE INDEX "audit_user_match_results_job_id_idx" ON "audit_user_match_results"("job_id");

-- CreateIndex: Job notifications
CREATE INDEX "audit_job_notify_job_id_idx" ON "audit_job_notify"("job_id");
CREATE INDEX "audit_job_notify_created_at_idx" ON "audit_job_notify"("created_at");

-- CreateIndex: Job notification results
CREATE INDEX "audit_job_notify_results_notify_request_id_idx" ON "audit_job_notify_results"("notify_request_id");
CREATE INDEX "audit_job_notify_results_user_id_idx" ON "audit_job_notify_results"("user_id");

-- AddForeignKey: User match results -> User match requests
ALTER TABLE "audit_user_match_results" ADD CONSTRAINT "audit_user_match_results_match_request_id_fkey" FOREIGN KEY ("match_request_id") REFERENCES "audit_user_match_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: Job notification results -> Job notifications
ALTER TABLE "audit_job_notify_results" ADD CONSTRAINT "audit_job_notify_results_notify_request_id_fkey" FOREIGN KEY ("notify_request_id") REFERENCES "audit_job_notify"("id") ON DELETE CASCADE ON UPDATE CASCADE;
