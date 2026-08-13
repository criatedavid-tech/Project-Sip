CREATE TABLE "dialer_campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" text NOT NULL,
  "provider" text DEFAULT 'twilio' NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "created_by" uuid,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "dialer_campaign_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "contact_id" uuid,
  "phone_number" text NOT NULL,
  "position" integer NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "assigned_user_id" uuid,
  "claimed_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "disposition" text,
  "notes" text,
  "voice_call_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "dialer_campaigns" ADD CONSTRAINT "dialer_campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "dialer_campaigns" ADD CONSTRAINT "dialer_campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "dialer_campaign_items" ADD CONSTRAINT "dialer_campaign_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "dialer_campaign_items" ADD CONSTRAINT "dialer_campaign_items_campaign_id_dialer_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."dialer_campaigns"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "dialer_campaign_items" ADD CONSTRAINT "dialer_campaign_items_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "dialer_campaign_items" ADD CONSTRAINT "dialer_campaign_items_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "dialer_campaign_items" ADD CONSTRAINT "dialer_campaign_items_voice_call_id_voice_calls_id_fk" FOREIGN KEY ("voice_call_id") REFERENCES "public"."voice_calls"("id") ON DELETE set null;--> statement-breakpoint
CREATE INDEX "dialer_campaigns_org_status_idx" ON "dialer_campaigns" ("organization_id", "status");--> statement-breakpoint
CREATE UNIQUE INDEX "dialer_campaign_items_campaign_position_unique" ON "dialer_campaign_items" ("campaign_id", "position");--> statement-breakpoint
CREATE INDEX "dialer_campaign_items_queue_idx" ON "dialer_campaign_items" ("organization_id", "campaign_id", "status", "position");--> statement-breakpoint
CREATE INDEX "dialer_campaign_items_assigned_idx" ON "dialer_campaign_items" ("assigned_user_id", "status");--> statement-breakpoint
ALTER TABLE "dialer_campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dialer_campaigns" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "dialer_campaigns_tenant_isolation" ON "dialer_campaigns" USING ("organization_id" = current_org_id()) WITH CHECK ("organization_id" = current_org_id());--> statement-breakpoint
ALTER TABLE "dialer_campaign_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dialer_campaign_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "dialer_campaign_items_tenant_isolation" ON "dialer_campaign_items" USING ("organization_id" = current_org_id()) WITH CHECK ("organization_id" = current_org_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "dialer_campaigns", "dialer_campaign_items" TO omni_app;
