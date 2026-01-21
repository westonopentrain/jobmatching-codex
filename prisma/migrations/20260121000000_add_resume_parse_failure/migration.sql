-- CreateTable
CREATE TABLE "resume_parse_failures" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "file_url" TEXT,
    "error" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resume_parse_failures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "resume_parse_failures_created_at_idx" ON "resume_parse_failures"("created_at");

-- CreateIndex
CREATE INDEX "resume_parse_failures_user_id_idx" ON "resume_parse_failures"("user_id");
