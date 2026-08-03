ALTER TABLE "call_transcriptions"
  ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;

ALTER TABLE "call_transcriptions"
  ADD COLUMN "next_retry_at" timestamp with time zone;

CREATE INDEX "call_transcriptions_retry_idx"
  ON "call_transcriptions" ("status", "next_retry_at");
