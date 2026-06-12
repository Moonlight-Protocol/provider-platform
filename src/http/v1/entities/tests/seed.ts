/**
 * Seed helpers for the entities-interaction tests. Insert directly via the
 * PGlite drizzle client so tests can construct exact approval/identity states.
 */
import { Keypair } from "stellar-sdk";
import { drizzleClient } from "./pglite_db.ts";
import { paymentProvider } from "@/persistence/drizzle/entity/pp.entity.ts";
import { account } from "@/persistence/drizzle/entity/account.entity.ts";
import { entity } from "@/persistence/drizzle/entity/entity.entity.ts";
import { EntityStatus } from "@/persistence/drizzle/entity/entity.entity.ts";
import { ppEntityApproval } from "@/persistence/drizzle/entity/pp-entity-approval.entity.ts";

/** Random Stellar public key. */
export function testPubkey(): string {
  return Keypair.random().publicKey();
}

/** Seed a payment provider owned by `ownerPublicKey`. */
export async function seedPp(opts: {
  publicKey: string;
  ownerPublicKey: string;
  label?: string;
}): Promise<void> {
  await drizzleClient.insert(paymentProvider).values({
    id: crypto.randomUUID(),
    publicKey: opts.publicKey,
    encryptedSk: "test-encrypted-sk",
    derivationIndex: 0,
    ownerPublicKey: opts.ownerPublicKey,
    isActive: true,
    label: opts.label ?? null,
  });
}

/** Seed an entity + account (account.id is the pubkey). */
export async function seedEntity(opts: {
  pubkey: string;
  name: string;
  jurisdictions?: string[];
}): Promise<void> {
  const entityId = crypto.randomUUID();
  await drizzleClient.insert(entity).values({
    id: entityId,
    name: opts.name,
    jurisdictions: opts.jurisdictions ?? [],
  });
  await drizzleClient.insert(account).values({
    id: opts.pubkey,
    type: "USER",
    entityId,
  });
}

/** Seed a pp_entity_approvals row with explicit status + timestamps. */
export async function seedApproval(opts: {
  ppPublicKey: string;
  accountPubkey: string;
  status: EntityStatus;
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date | null;
}): Promise<void> {
  const ts = opts.updatedAt ?? new Date();
  await drizzleClient.insert(ppEntityApproval).values({
    id: crypto.randomUUID(),
    ppPublicKey: opts.ppPublicKey,
    accountPubkey: opts.accountPubkey,
    status: opts.status,
    createdAt: opts.createdAt ?? ts,
    updatedAt: ts,
    deletedAt: opts.deletedAt ?? null,
  });
}

export { EntityStatus };
