-- CreateTable
CREATE TABLE "audit_upsert_failures" (
    "id" SERIAL NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "request_id" TEXT,
    "error_code" TEXT NOT NULL,
    "error_message" TEXT NOT NULL,
    "raw_input" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_upsert_failures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_upsert_failures_entity_type_created_at_idx" ON "audit_upsert_failures"("entity_type", "created_at");

-- CreateIndex
CREATE INDEX "audit_upsert_failures_entity_id_idx" ON "audit_upsert_failures"("entity_id");
