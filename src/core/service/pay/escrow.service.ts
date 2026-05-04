/**
 * Escrow service — manages funds held for unverified receivers.
 *
 * When a send targets an address with no KYC:
 * 1. PP creates UTXOs at PP-controlled escrow addresses
 * 2. Stores mapping in pay_escrow: these UTXOs held for address G...
 *
 * When receiver completes KYC:
 * - Self-custodial: PP spends escrow UTXOs → creates new ones at user-derived P256 addresses
 * - Custodial: PP credits the custodial account balance, escrow UTXOs stay PP-controlled
 *
 * Funds never leave the channel — privacy preserved.
 */
import { and, eq, isNull } from "drizzle-orm";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PayEscrowRepository } from "@/persistence/drizzle/repository/pay-escrow.repository.ts";
import { PayKycRepository } from "@/persistence/drizzle/repository/pay-kyc.repository.ts";
import {
  payEscrow,
  PayEscrowStatus,
} from "@/persistence/drizzle/entity/pay-escrow.entity.ts";
import {
  payTransaction,
  PayTransactionStatus,
  PayTransactionType,
} from "@/persistence/drizzle/entity/pay-transaction.entity.ts";
import { payCustodialAccount } from "@/persistence/drizzle/entity/pay-custodial-account.entity.ts";
import { PayKycStatus } from "@/persistence/drizzle/entity/pay-kyc.entity.ts";
import { LOG } from "@/config/logger.ts";

const escrowRepo = new PayEscrowRepository(drizzleClient);
const kycRepo = new PayKycRepository(drizzleClient);

/**
 * Create an escrow record when sending to an unverified address.
 */
export async function createEscrow(opts: {
  senderAddress: string;
  receiverAddress: string;
  amount: bigint;
  mode: "self" | "custodial";
  bundleId?: string;
  utxoPublicKeys?: string[];
}): Promise<string> {
  const id = crypto.randomUUID();

  await escrowRepo.create({
    id,
    heldForAddress: opts.receiverAddress,
    senderAddress: opts.senderAddress,
    amount: opts.amount,
    status: PayEscrowStatus.HELD,
    utxoPublicKeys: opts.utxoPublicKeys
      ? JSON.stringify(opts.utxoPublicKeys)
      : null,
    bundleId: opts.bundleId ?? null,
    mode: opts.mode,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  LOG.info("Escrow created", {
    id,
    heldFor: opts.receiverAddress,
    amount: opts.amount.toString(),
    mode: opts.mode,
  });

  return id;
}

/**
 * Claim all held escrow records for an address after KYC verification.
 *
 * For self-custodial: TODO — PP builds bundle to spend escrow UTXOs
 * and create new ones at user-derived P256 addresses.
 *
 * For custodial: credits the custodial account balance directly.
 *
 * Uses a DB transaction with row-level locking to prevent double-claims.
 */
export async function claimEscrowForAddress(address: string): Promise<{
  claimed: number;
  totalAmount: bigint;
}> {
  const kyc = await kycRepo.findByAddress(address);
  if (!kyc || kyc.status !== PayKycStatus.VERIFIED) {
    throw new Error("KYC not verified for this address");
  }

  return await drizzleClient.transaction(async (tx) => {
    // SELECT held escrows FOR UPDATE to prevent concurrent double-claims
    const held = await tx
      .select()
      .from(payEscrow)
      .where(
        and(
          eq(payEscrow.heldForAddress, address),
          eq(payEscrow.status, PayEscrowStatus.HELD),
          isNull(payEscrow.deletedAt),
        ),
      )
      .for("update");

    if (held.length === 0) {
      return { claimed: 0, totalAmount: 0n };
    }

    let totalAmount = 0n;

    for (const escrow of held) {
      if (escrow.mode === "custodial") {
        // Look up the custodial account by deposit address (not username)
        const [account] = await tx
          .select()
          .from(payCustodialAccount)
          .where(eq(payCustodialAccount.depositAddress, address))
          .for("update");

        if (account) {
          await tx
            .update(payCustodialAccount)
            .set({
              balance: account.balance + escrow.amount,
              updatedAt: new Date(),
            })
            .where(eq(payCustodialAccount.id, account.id));
        }
      }
      // For self-custodial: TODO — build spend+create bundle

      // Mark as claimed
      await tx
        .update(payEscrow)
        .set({
          status: PayEscrowStatus.CLAIMED,
          updatedAt: new Date(),
        })
        .where(eq(payEscrow.id, escrow.id));

      // Create receive transaction (within the same DB transaction)
      await tx.insert(payTransaction).values({
        id: crypto.randomUUID(),
        type: PayTransactionType.RECEIVE,
        status: PayTransactionStatus.COMPLETED,
        amount: escrow.amount,
        assetCode: escrow.assetCode,
        fromAddress: escrow.senderAddress,
        toAddress: address,
        jurisdictionFrom: null,
        jurisdictionTo: kyc.jurisdiction ?? null,
        accountId: address,
        mode: escrow.mode,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      totalAmount += escrow.amount;
    }

    LOG.info("Escrow claimed", {
      address,
      claimed: held.length,
      totalAmount: totalAmount.toString(),
    });

    return { claimed: held.length, totalAmount };
  });
}

/**
 * Get pending escrow summary for an address.
 */
export async function getEscrowSummary(address: string): Promise<{
  count: number;
  totalAmount: bigint;
}> {
  const held = await escrowRepo.findHeldForAddress(address);
  const totalAmount = held.reduce((sum, e) => sum + e.amount, 0n);
  return { count: held.length, totalAmount };
}
