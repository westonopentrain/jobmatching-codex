-- CreateTable
CREATE TABLE "audit_re_notify" (
    "id" SERIAL NOT NULL,
    "job_id" TEXT NOT NULL,
    "request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total_qualified" INTEGER NOT NULL,
    "previously_notified" INTEGER NOT NULL,
    "newly_qualified" INTEGER NOT NULL,
    "elapsed_ms" DOUBLE PRECISION,

    CONSTRAINT "audit_re_notify_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_recommended_jobs" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expertise_tier" TEXT,
    "country" TEXT,
    "languages" TEXT[],
    "active_jobs" INTEGER NOT NULL,
    "scored_jobs" INTEGER NOT NULL,
    "recommended_count" INTEGER NOT NULL,
    "skipped_by_country" INTEGER NOT NULL,
    "skipped_by_language" INTEGER NOT NULL,
    "elapsed_ms" DOUBLE PRECISION,

    CONSTRAINT "audit_recommended_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_re_notify_job_id_idx" ON "audit_re_notify"("job_id");

-- CreateIndex
CREATE INDEX "audit_re_notify_created_at_idx" ON "audit_re_notify"("created_at");

-- CreateIndex
CREATE INDEX "audit_recommended_jobs_user_id_idx" ON "audit_recommended_jobs"("user_id");

-- CreateIndex
CREATE INDEX "audit_recommended_jobs_created_at_idx" ON "audit_recommended_jobs"("created_at");
