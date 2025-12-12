CREATE TYPE "public"."user_status" AS ENUM('UNVERIFIED', 'APPROVED', 'PENDING', 'BLOCKED');--> statement-breakpoint
CREATE TYPE "public"."account_type" AS ENUM('OPEX', 'USER');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."challenge_status" AS ENUM('VERIFIED', 'UNVERIFIED');--> statement-breakpoint
CREATE TYPE "public"."bundle_status" AS ENUM('PENDING', 'COMPLETED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('UNVERIFIED', 'VERIFIED');--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"status" "user_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "account_type" NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"status" "session_status" NOT NULL,
	"jwt_token" text,
	"account_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"status" "challenge_status" NOT NULL,
	"ttl" timestamp with time zone NOT NULL,
	"tx_hash" text NOT NULL,
	"tx_xdr" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "challenges_tx_hash_unique" UNIQUE("tx_hash")
);
--> statement-breakpoint
CREATE TABLE "operations_bundles" (
	"id" text PRIMARY KEY NOT NULL,
	"status" "bundle_status" NOT NULL,
	"ttl" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"status" "transaction_status" NOT NULL,
	"timeout" timestamp with time zone NOT NULL,
	"ledger_sequence" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "utxos" (
	"id" text PRIMARY KEY NOT NULL,
	"amount" bigint NOT NULL,
	"account_id" text NOT NULL,
	"spent_by_account_id" text,
	"created_at_bundle_id" text,
	"spent_at_bundle_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bundles_transactions" (
	"bundle_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "bundles_transactions_bundle_id_transaction_id_pk" PRIMARY KEY("bundle_id","transaction_id")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utxos" ADD CONSTRAINT "utxos_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utxos" ADD CONSTRAINT "utxos_created_at_bundle_id_operations_bundles_id_fk" FOREIGN KEY ("created_at_bundle_id") REFERENCES "public"."operations_bundles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utxos" ADD CONSTRAINT "utxos_spent_at_bundle_id_operations_bundles_id_fk" FOREIGN KEY ("spent_at_bundle_id") REFERENCES "public"."operations_bundles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundles_transactions" ADD CONSTRAINT "bundles_transactions_bundle_id_operations_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."operations_bundles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundles_transactions" ADD CONSTRAINT "bundles_transactions_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;