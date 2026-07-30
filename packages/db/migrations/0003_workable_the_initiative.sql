CREATE TABLE "contact_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"channel_type" text NOT NULL,
	"identifier" text NOT NULL,
	"is_primary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text,
	"email" text,
	"company" text,
	"notes" text,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_interaction_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phone_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" text NOT NULL,
	"label" text,
	"kind" text DEFAULT 'unknown' NOT NULL,
	"sip_trunk_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"phone_number" text NOT NULL,
	"waba_id" text NOT NULL,
	"phone_number_id" text NOT NULL,
	"provider" text DEFAULT 'meta_cloud_api' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"assignee_id" uuid,
	"assigned_by_id" uuid,
	"reason" text,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unassigned_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"channel_type" text NOT NULL,
	"whatsapp_account_id" uuid,
	"phone_number_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"current_assignee_id" uuid,
	"last_inbound_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"first_response_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"status" text NOT NULL,
	"provider_event_id" text,
	"error_code" text,
	"error_message" text,
	"raw_payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"sender_type" text NOT NULL,
	"sender_user_id" uuid,
	"content_type" text NOT NULL,
	"body" text,
	"media_file_id" uuid,
	"provider" text NOT NULL,
	"provider_message_id" text,
	"idempotency_key" text NOT NULL,
	"reply_to_message_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"error_code" text,
	"error_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"queue_name" text NOT NULL,
	"job_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"dispatched_at" timestamp with time zone,
	"attempts" text DEFAULT '0' NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text,
	"signature_valid" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"attempts" text DEFAULT '0' NOT NULL,
	"error_message" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_channels" ADD CONSTRAINT "contact_channels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_channels" ADD CONSTRAINT "contact_channels_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" ADD CONSTRAINT "whatsapp_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_assignments" ADD CONSTRAINT "conversation_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_assignments" ADD CONSTRAINT "conversation_assignments_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_assignments" ADD CONSTRAINT "conversation_assignments_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_assignments" ADD CONSTRAINT "conversation_assignments_assigned_by_id_users_id_fk" FOREIGN KEY ("assigned_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_whatsapp_account_id_whatsapp_accounts_id_fk" FOREIGN KEY ("whatsapp_account_id") REFERENCES "public"."whatsapp_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_current_assignee_id_users_id_fk" FOREIGN KEY ("current_assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_status_events" ADD CONSTRAINT "message_status_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_status_events" ADD CONSTRAINT "message_status_events_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_outbox" ADD CONSTRAINT "event_outbox_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_channels_identifier_unique" ON "contact_channels" USING btree ("organization_id","channel_type","identifier");--> statement-breakpoint
CREATE INDEX "contact_channels_contact_idx" ON "contact_channels" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contacts_org_idx" ON "contacts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "contacts_org_last_interaction_idx" ON "contacts" USING btree ("organization_id","last_interaction_at");--> statement-breakpoint
CREATE UNIQUE INDEX "phone_numbers_unique" ON "phone_numbers" USING btree ("organization_id","number");--> statement-breakpoint
CREATE INDEX "phone_numbers_org_idx" ON "phone_numbers" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_accounts_phone_number_id_unique" ON "whatsapp_accounts" USING btree ("phone_number_id");--> statement-breakpoint
CREATE INDEX "whatsapp_accounts_org_idx" ON "whatsapp_accounts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "conversation_assignments_conversation_idx" ON "conversation_assignments" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_open_unique" ON "conversations" USING btree ("organization_id","contact_id","channel_type") WHERE status in ('open', 'pending');--> statement-breakpoint
CREATE INDEX "conversations_org_status_idx" ON "conversations" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "conversations_org_last_message_idx" ON "conversations" USING btree ("organization_id","last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_assignee_idx" ON "conversations" USING btree ("current_assignee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_status_events_unique" ON "message_status_events" USING btree ("message_id","status","provider_event_id");--> statement-breakpoint
CREATE INDEX "message_status_events_message_idx" ON "message_status_events" USING btree ("message_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_idempotency_unique" ON "messages" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_provider_message_unique" ON "messages" USING btree ("organization_id","provider","provider_message_id") WHERE provider_message_id is not null;--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "event_outbox_job_unique" ON "event_outbox" USING btree ("queue_name","job_id");--> statement-breakpoint
CREATE INDEX "event_outbox_pending_idx" ON "event_outbox" USING btree ("dispatched_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_provider_event_unique" ON "webhook_deliveries" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_status_idx" ON "webhook_deliveries" USING btree ("status","received_at");