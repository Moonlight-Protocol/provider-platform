// deno-lint-ignore-file no-explicit-any
/**
 * PGlite-backed test database for integration tests.
 *
 * Uses PGlite (in-memory PostgreSQL via WASM) with Drizzle ORM,
 * giving us real SQL, real transactions, and real FOR UPDATE locking
 * without needing an external PostgreSQL server.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/persistence/drizzle/entity/index.ts";

// Re-export a compatible DrizzleClient type
// The real config.ts does: const drizzleClient = drizzle({client, schema})
// and exports: type DrizzleClient = typeof drizzleClient
// Both pglite and postgres-js drizzle() return compatible query-builder APIs.

// ── Migration SQL ──────────────────────────────────────────────────────
// PGlite needs the full schema. We inline the migration statements here
// (stripped of drizzle-kit's "--> statement-breakpoint" markers).

const MIGRATIONS = [
  // 0000_init.sql
  `
  CREATE TYPE "public"."user_status" AS ENUM('UNVERIFIED', 'APPROVED', 'PENDING', 'BLOCKED');
  CREATE TYPE "public"."account_type" AS ENUM('OPEX', 'USER');
  CREATE TYPE "public"."session_status" AS ENUM('ACTIVE', 'INACTIVE');
  CREATE TYPE "public"."challenge_status" AS ENUM('VERIFIED', 'UNVERIFIED');
  CREATE TYPE "public"."bundle_status" AS ENUM('PENDING', 'COMPLETED', 'EXPIRED');
  CREATE TYPE "public"."transaction_status" AS ENUM('UNVERIFIED', 'VERIFIED');

  CREATE TABLE "users" (
    "id" text PRIMARY KEY NOT NULL,
    "status" "user_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "created_by" text,
    "updated_by" text,
    "deleted_at" timestamp with time zone
  );

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

  ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
  ALTER TABLE "challenges" ADD CONSTRAINT "challenges_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
  ALTER TABLE "utxos" ADD CONSTRAINT "utxos_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
  ALTER TABLE "utxos" ADD CONSTRAINT "utxos_created_at_bundle_id_operations_bundles_id_fk" FOREIGN KEY ("created_at_bundle_id") REFERENCES "public"."operations_bundles"("id") ON DELETE no action ON UPDATE no action;
  ALTER TABLE "utxos" ADD CONSTRAINT "utxos_spent_at_bundle_id_operations_bundles_id_fk" FOREIGN KEY ("spent_at_bundle_id") REFERENCES "public"."operations_bundles"("id") ON DELETE no action ON UPDATE no action;
  ALTER TABLE "bundles_transactions" ADD CONSTRAINT "bundles_transactions_bundle_id_operations_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."operations_bundles"("id") ON DELETE no action ON UPDATE no action;
  ALTER TABLE "bundles_transactions" ADD CONSTRAINT "bundles_transactions_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;
  `,

  // 0001_add_operations_mlxdr_to_bundles.sql
  `ALTER TABLE "operations_bundles" ADD COLUMN "operations_mlxdr" jsonb NOT NULL DEFAULT '[]'::jsonb;`,

  // 0002_add_processing_status_to_bundle.sql
  `ALTER TYPE "public"."bundle_status" ADD VALUE IF NOT EXISTS 'PROCESSING';`,

  // 0003_add_fee_to_bundles.sql
  `ALTER TABLE "operations_bundles" ADD COLUMN "fee" bigint NOT NULL DEFAULT 0;`,

  // 0004_add_failed_status_to_transaction.sql
  `ALTER TYPE "transaction_status" ADD VALUE 'FAILED';`,

  // 0005_young_kabuki.sql (mempool_metrics + index)
  `
  CREATE TABLE "mempool_metrics" (
    "id" serial PRIMARY KEY NOT NULL,
    "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
    "platform_version" text NOT NULL,
    "queue_depth" integer NOT NULL,
    "slot_count" integer NOT NULL,
    "bundles_completed" integer DEFAULT 0 NOT NULL,
    "bundles_expired" integer DEFAULT 0 NOT NULL,
    "avg_processing_ms" double precision,
    "p95_processing_ms" double precision,
    "throughput_per_min" double precision
  );
  CREATE INDEX "idx_mempool_metrics_recorded_at" ON "mempool_metrics" USING btree ("recorded_at");
  CREATE INDEX "idx_mempool_metrics_version" ON "mempool_metrics" USING btree ("platform_version");
  CREATE INDEX "idx_bundles_status_updated" ON "operations_bundles" USING btree ("status","deleted_at","updated_at");
  `,

  // 0005_add_retry_fail_reason_fields.sql
  `
  ALTER TYPE "public"."bundle_status" ADD VALUE IF NOT EXISTS 'FAILED';
  ALTER TABLE "operations_bundles" ADD COLUMN IF NOT EXISTS "retry_count" integer DEFAULT 0 NOT NULL;
  ALTER TABLE "operations_bundles" ADD COLUMN IF NOT EXISTS "last_failure_reason" text;
  `,

  // 0005b_add_channel_contract_id.sql
  `ALTER TABLE "operations_bundles" ADD COLUMN IF NOT EXISTS "channel_contract_id" text;`,

  // 0006_pay_tables.sql
  `
  CREATE TYPE "public"."pay_kyc_status" AS ENUM('NONE', 'PENDING', 'VERIFIED');
  CREATE TYPE "public"."pay_custodial_status" AS ENUM('ACTIVE', 'SUSPENDED');
  CREATE TYPE "public"."pay_transaction_status" AS ENUM('PENDING', 'COMPLETED', 'FAILED', 'EXPIRED');
  CREATE TYPE "public"."pay_transaction_type" AS ENUM('DEPOSIT', 'WITHDRAW', 'SEND', 'RECEIVE');
  CREATE TYPE "public"."pay_escrow_status" AS ENUM('HELD', 'CLAIMED', 'EXPIRED');

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

  CREATE INDEX "idx_pay_kyc_address" ON "pay_kyc" USING btree ("address");
  CREATE INDEX "idx_pay_custodial_username" ON "pay_custodial_accounts" USING btree ("username");
  CREATE INDEX "idx_pay_tx_account_status" ON "pay_transactions" USING btree ("account_id","status");
  CREATE INDEX "idx_pay_tx_account_created" ON "pay_transactions" USING btree ("account_id","created_at");
  CREATE INDEX "idx_pay_escrow_held_for" ON "pay_escrow" USING btree ("held_for_address","status");
  CREATE INDEX "idx_pay_escrow_sender" ON "pay_escrow" USING btree ("sender_address");
  `,
];

// ── PGlite instance ────────────────────────────────────────────────────

type PGliteDrizzle = ReturnType<typeof drizzle<typeof schema>>;

let pg: PGlite;
let _drizzleClient: PGliteDrizzle;
let _initialized = false;

async function ensureInitialized() {
  if (_initialized) return;

  pg = new PGlite();

  for (const sql of MIGRATIONS) {
    await pg.exec(sql);
  }

  _drizzleClient = drizzle({ client: pg, schema });
  _initialized = true;
}

// We need a lazy proxy because modules that import `drizzleClient` do so
// at module load time, before `ensureInitialized()` has run. The proxy
// forwards all property access / method calls to the real client once
// it exists.
const drizzleClientProxy: PGliteDrizzle = new Proxy({} as PGliteDrizzle, {
  get(_target, prop) {
    if (!_initialized) {
      throw new Error(
        "PGlite not initialized. Call ensureInitialized() before using drizzleClient."
      );
    }
    const val = (_drizzleClient as any)[prop];
    return typeof val === "function" ? val.bind(_drizzleClient) : val;
  },
});

export const drizzleClient = drizzleClientProxy;
export type DrizzleClient = PGliteDrizzle;

// ── Public helpers ─────────────────────────────────────────────────────

export { ensureInitialized };

/**
 * Truncate all pay_* tables. Call between tests for a clean slate.
 */
export async function resetDb(): Promise<void> {
  await ensureInitialized();
  await pg.exec(`
    TRUNCATE TABLE pay_escrow, pay_transactions, pay_custodial_accounts, pay_kyc CASCADE;
  `);
}

/**
 * Shut down PGlite. Call after all tests are done.
 */
export async function closeDb(): Promise<void> {
  if (_initialized) {
    await pg.close();
    _initialized = false;
  }
}
