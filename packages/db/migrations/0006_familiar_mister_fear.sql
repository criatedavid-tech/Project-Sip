CREATE TABLE "call_recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text DEFAULT 'audio/wav' NOT NULL,
	"size_bytes" integer,
	"duration_seconds" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"available_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telephony_extensions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"extension" text NOT NULL,
	"endpoint_id" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"external_call_id" text NOT NULL,
	"linked_id" text,
	"direction" text NOT NULL,
	"from_number" text,
	"to_number" text,
	"status" text DEFAULT 'ringing' NOT NULL,
	"user_id" uuid,
	"extension_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer,
	"hangup_cause" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_recordings" ADD CONSTRAINT "call_recordings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_recordings" ADD CONSTRAINT "call_recordings_call_id_voice_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."voice_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telephony_extensions" ADD CONSTRAINT "telephony_extensions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telephony_extensions" ADD CONSTRAINT "telephony_extensions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_extension_id_telephony_extensions_id_fk" FOREIGN KEY ("extension_id") REFERENCES "public"."telephony_extensions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "call_recordings_call_unique" ON "call_recordings" USING btree ("call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "call_recordings_org_storage_unique" ON "call_recordings" USING btree ("organization_id","storage_key");--> statement-breakpoint
CREATE INDEX "call_recordings_org_created_idx" ON "call_recordings" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telephony_extensions_org_extension_unique" ON "telephony_extensions" USING btree ("organization_id","extension");--> statement-breakpoint
CREATE UNIQUE INDEX "telephony_extensions_org_user_unique" ON "telephony_extensions" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telephony_extensions_endpoint_unique" ON "telephony_extensions" USING btree ("endpoint_id");--> statement-breakpoint
CREATE INDEX "telephony_extensions_org_idx" ON "telephony_extensions" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_calls_org_external_unique" ON "voice_calls" USING btree ("organization_id","external_call_id");--> statement-breakpoint
CREATE INDEX "voice_calls_org_started_idx" ON "voice_calls" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE INDEX "voice_calls_user_idx" ON "voice_calls" USING btree ("user_id","started_at");--> statement-breakpoint

-- Telefonia também é dado de tenant: chamadas contêm números pessoais e as
-- gravações são especialmente sensíveis. O isolamento fica no Postgres, não
-- apenas nos filtros da API.
ALTER TABLE "telephony_extensions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telephony_extensions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "telephony_extensions_tenant_isolation" ON "telephony_extensions"
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());--> statement-breakpoint

ALTER TABLE "voice_calls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "voice_calls" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "voice_calls_tenant_isolation" ON "voice_calls"
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());--> statement-breakpoint

ALTER TABLE "call_recordings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "call_recordings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "call_recordings_tenant_isolation" ON "call_recordings"
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());
