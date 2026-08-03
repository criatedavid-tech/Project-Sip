CREATE TABLE "call_transcriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"recording_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text NOT NULL,
	"provider_job_id" text,
	"model" text,
	"language" text,
	"full_text" text,
	"segments" jsonb,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_transcriptions" ADD CONSTRAINT "call_transcriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_transcriptions" ADD CONSTRAINT "call_transcriptions_recording_id_call_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."call_recordings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "call_transcriptions_recording_unique" ON "call_transcriptions" USING btree ("recording_id");--> statement-breakpoint
CREATE INDEX "call_transcriptions_org_created_idx" ON "call_transcriptions" USING btree ("organization_id","created_at");--> statement-breakpoint

-- Transcrições contêm o conteúdo integral das conversas e seguem o mesmo
-- isolamento das chamadas e gravações que lhes deram origem.
ALTER TABLE "call_transcriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "call_transcriptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "call_transcriptions_tenant_isolation" ON "call_transcriptions"
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());
