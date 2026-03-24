CREATE TYPE "public"."pay_kyc_status" AS ENUM('NONE', 'PENDING', 'VERIFIED');--> statement-breakpoint
CREATE TYPE "public"."pay_custodial_status" AS ENUM('ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."pay_transaction_status" AS ENUM('PENDING', 'COMPLETED', 'FAILED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."pay_transaction_type" AS ENUM('DEPOSIT', 'WITHDRAW', 'SEND', 'RECEIVE');--> statement-breakpoint
CREATE TYPE "public"."pay_escrow_status" AS ENUM('HELD', 'CLAIMED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "pay_kyc" (
	"id" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"status" "pay_kyc_status" DEFAULT 'NONE' NOT NULL,
	"jurisdiction" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "pay_kyc_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "pay_custodial_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"deposit_address" text NOT NULL,
	"balance" bigint NOT NULL,
	"status" "pay_custodial_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "pay_custodial_accounts_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "pay_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "pay_transaction_type" NOT NULL,
	"status" "pay_transaction_status" NOT NULL,
	"amount" bigint NOT NULL,
	"asset_code" text DEFAULT 'XLM' NOT NULL,
	"from_address" text,
	"to_address" text,
	"jurisdiction_from" text,
	"jurisdiction_to" text,
	"bundle_id" text,
	"account_id" text NOT NULL,
	"mode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pay_escrow" (
	"id" text PRIMARY KEY NOT NULL,
	"held_for_address" text NOT NULL,
	"sender_address" text NOT NULL,
	"amount" bigint NOT NULL,
	"asset_code" text DEFAULT 'XLM' NOT NULL,
	"status" "pay_escrow_status" DEFAULT 'HELD' NOT NULL,
	"utxo_public_keys" text,
	"bundle_id" text,
	"claim_bundle_id" text,
	"mode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "idx_pay_kyc_address" ON "pay_kyc" USING btree ("address");--> statement-breakpoint
CREATE INDEX "idx_pay_custodial_username" ON "pay_custodial_accounts" USING btree ("username");--> statement-breakpoint
CREATE INDEX "idx_pay_tx_account_status" ON "pay_transactions" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "idx_pay_tx_account_created" ON "pay_transactions" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_pay_escrow_held_for" ON "pay_escrow" USING btree ("held_for_address","status");--> statement-breakpoint
CREATE INDEX "idx_pay_escrow_sender" ON "pay_escrow" USING btree ("sender_address");