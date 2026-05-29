ALTER TYPE "user_status" RENAME TO "entity_status";--> statement-breakpoint
ALTER TABLE "users" RENAME TO "entities";--> statement-breakpoint
ALTER INDEX "users_pkey" RENAME TO "entities_pkey";--> statement-breakpoint
ALTER TABLE "accounts" RENAME COLUMN "user_id" TO "entity_id";--> statement-breakpoint
ALTER TABLE "accounts" RENAME CONSTRAINT "accounts_user_id_users_id_fk" TO "accounts_entity_id_entities_id_fk";--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "jurisdictions" text[];