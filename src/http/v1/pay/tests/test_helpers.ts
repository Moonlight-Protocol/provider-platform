/**
 * Integration test helpers for the pay module.
 *
 * Uses PGlite (in-memory PostgreSQL via WASM) with Drizzle ORM — real SQL,
 * real transactions, real FOR UPDATE locking, no external dependencies.
 *
 * Run with: deno test --allow-all --config src/http/v1/pay/tests/deno.json src/http/v1/pay/tests/
 */
import { eq } from "drizzle-orm";
import {
  drizzleClient,
  resetDb,
  closeDb,
  ensureInitialized,
} from "./pglite_db.ts";
import {
  payCustodialAccount,
  PayCustodialStatus,
} from "@/persistence/drizzle/entity/pay-custodial-account.entity.ts";
import {
  payKyc,
  PayKycStatus,
} from "@/persistence/drizzle/entity/pay-kyc.entity.ts";
import {
  payEscrow,
  PayEscrowStatus,
} from "@/persistence/drizzle/entity/pay-escrow.entity.ts";
import {
  payTransaction,
  PayTransactionType,
  PayTransactionStatus,
} from "@/persistence/drizzle/entity/pay-transaction.entity.ts";
import { hashPassword } from "@/http/v1/pay/custodial/crypto.ts";
import { Keypair } from "stellar-sdk";

// ── Utilities ────────────────────────────────────────────────────────────

/** Generate a random test username. */
export function testUsername(): string {
  return `test_${crypto.randomUUID().slice(0, 8)}`;
}

/** Generate a random Stellar public key. */
export function testAddress(): string {
  return Keypair.random().publicKey();
}

// ── Seed helpers ─────────────────────────────────────────────────────────

/**
 * Create a custodial test account in the PGlite database.
 */
export async function createTestAccount(opts: {
  username?: string;
  password?: string;
  balance?: bigint;
  status?: PayCustodialStatus;
  depositAddress?: string;
}): Promise<{
  id: string;
  username: string;
  depositAddress: string;
  token: string;
}> {
  const id = crypto.randomUUID();
  const username = opts.username ?? testUsername();
  const password = opts.password ?? "test-password-123";
  const depositAddress = opts.depositAddress ?? testAddress();
  const balance = opts.balance ?? 0n;
  const status = opts.status ?? PayCustodialStatus.ACTIVE;

  const passwordHash = await hashPassword(password);

  await drizzleClient.insert(payCustodialAccount).values({
    id,
    username,
    passwordHash,
    depositAddress,
    balance,
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
  });

  return { id, username, depositAddress, token: "mock-token" };
}

/** Create a KYC record. */
export async function createTestKyc(
  address: string,
  status: PayKycStatus,
): Promise<string> {
  const id = crypto.randomUUID();

  await drizzleClient.insert(payKyc).values({
    id,
    address,
    status,
    jurisdiction: status === PayKycStatus.VERIFIED ? "US" : null,
    verifiedAt: status === PayKycStatus.VERIFIED ? new Date() : null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
  });

  return id;
}

/** Create an escrow record. */
export async function createTestEscrow(opts: {
  heldForAddress: string;
  senderAddress: string;
  amount: bigint;
  mode: "self" | "custodial";
  status?: PayEscrowStatus;
}): Promise<string> {
  const id = crypto.randomUUID();

  await drizzleClient.insert(payEscrow).values({
    id,
    heldForAddress: opts.heldForAddress,
    senderAddress: opts.senderAddress,
    amount: opts.amount,
    assetCode: "XLM",
    status: opts.status ?? PayEscrowStatus.HELD,
    utxoPublicKeys: null,
    bundleId: null,
    claimBundleId: null,
    mode: opts.mode,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
  });

  return id;
}

/** Create a pay_transaction record. */
export async function createTestTransaction(opts: {
  accountId: string;
  type?: PayTransactionType;
  status?: PayTransactionStatus;
  amount?: bigint;
  fromAddress?: string;
  toAddress?: string;
  mode?: "self" | "custodial";
}): Promise<string> {
  const id = crypto.randomUUID();

  await drizzleClient.insert(payTransaction).values({
    id,
    type: opts.type ?? PayTransactionType.SEND,
    status: opts.status ?? PayTransactionStatus.COMPLETED,
    amount: opts.amount ?? 1000n,
    assetCode: "XLM",
    fromAddress: opts.fromAddress ?? null,
    toAddress: opts.toAddress ?? null,
    jurisdictionFrom: null,
    jurisdictionTo: null,
    accountId: opts.accountId,
    mode: opts.mode ?? "custodial",
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
  });

  return id;
}

// ── Query helpers (for assertions) ───────────────────────────────────────

/** Read a custodial account by id. */
export async function getAccount(id: string) {
  const [result] = await drizzleClient
    .select()
    .from(payCustodialAccount)
    .where(eq(payCustodialAccount.id, id));
  return result;
}

/** Read all transaction records. */
export async function getAllTransactions() {
  return await drizzleClient.select().from(payTransaction);
}

/** Read all escrow records. */
export async function getAllEscrows() {
  return await drizzleClient.select().from(payEscrow);
}

/** Read all KYC records. */
export async function getAllKyc() {
  return await drizzleClient.select().from(payKyc);
}

// ── Re-exports ───────────────────────────────────────────────────────────

export { drizzleClient, resetDb, closeDb, ensureInitialized };
export { payCustodialAccount, PayCustodialStatus };
export { payKyc, PayKycStatus };
export { payEscrow, PayEscrowStatus };
export { payTransaction, PayTransactionType, PayTransactionStatus };
