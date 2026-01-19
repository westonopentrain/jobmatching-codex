-- CreateTable: Jobs (track active status)
CREATE TABLE "jobs" (
    "job_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "title" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("job_id")
);

-- CreateTable: Job-User Qualifications (track who qualifies for each job)
CREATE TABLE "job_user_qualifications" (
    "id" SERIAL NOT NULL,
    "job_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "qualifies" BOOLEAN NOT NULL DEFAULT false,
    "final_score" DOUBLE PRECISION,
    "domain_score" DOUBLE PRECISION,
    "task_score" DOUBLE PRECISION,
    "threshold_used" DOUBLE PRECISION,
    "filter_reason" TEXT,
    "notified_at" TIMESTAMP(3),
    "notified_via" TEXT,
    "evaluated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "job_active" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "job_user_qualifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Jobs
CREATE INDEX "jobs_is_active_idx" ON "jobs"("is_active");

-- CreateIndex: Job-User Qualifications - unique constraint
CREATE UNIQUE INDEX "job_user_qualifications_job_id_user_id_key" ON "job_user_qualifications"("job_id", "user_id");

-- CreateIndex: Job-User Qualifications - query indexes
CREATE INDEX "job_user_qualifications_job_id_idx" ON "job_user_qualifications"("job_id");
CREATE INDEX "job_user_qualifications_user_id_idx" ON "job_user_qualifications"("user_id");
CREATE INDEX "job_user_qualifications_job_id_qualifies_notified_at_idx" ON "job_user_qualifications"("job_id", "qualifies", "notified_at");
CREATE INDEX "job_user_qualifications_job_active_qualifies_idx" ON "job_user_qualifications"("job_active", "qualifies");

-- AddForeignKey: Job-User Qualifications -> Jobs
ALTER TABLE "job_user_qualifications" ADD CONSTRAINT "job_user_qualifications_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("job_id") ON DELETE CASCADE ON UPDATE CASCADE;
