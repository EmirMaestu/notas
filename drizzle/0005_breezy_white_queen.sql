ALTER TABLE "oauth_tokens" ADD COLUMN "family_created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
UPDATE "oauth_tokens" t SET "family_created_at" = f.first_at FROM (SELECT "family_id", min("created_at") AS first_at FROM "oauth_tokens" GROUP BY "family_id") f WHERE t."family_id" = f."family_id";
