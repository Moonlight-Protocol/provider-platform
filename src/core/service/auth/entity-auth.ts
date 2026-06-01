import type { Logger } from "@/utils/logger/index.ts";
import { verifyStellarSignature } from "./verify-stellar-signature.ts";

/**
 * In-memory challenge store for entity (KYC/KYB) submissions.
 *
 * Isolated from dashboard-auth's operator-login challenges so the two
 * surfaces cannot cross-influence each other. Entity challenges are not
 * tied to a PP — the URL path provides PP scoping; the challenge proves
 * the submitter controls the submitting wallet.
 */

const MAX_PENDING_ENTITY_CHALLENGES = 1000;
let challengeTtlMs = 5 * 60 * 1000;

export function setEntityChallengeTtlMs(ttlMs: number): void {
  challengeTtlMs = ttlMs;
}

interface PendingEntityChallenge {
  nonce: string;
  publicKey: string;
  createdAt: number;
}

const pending = new Map<string, PendingEntityChallenge>();

export function createEntityChallenge(
  publicKey: string,
  deps: { log: Logger },
): { nonce: string } {
  const log = deps.log.scope("createEntityChallenge");
  log.info("createEntityChallenge");
  log.debug("publicKey", publicKey);

  cleanupExpired();

  if (pending.size >= MAX_PENDING_ENTITY_CHALLENGES) {
    throw new Error("Too many pending challenges. Try again later.");
  }

  const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = btoa(String.fromCharCode(...nonceBytes));

  pending.set(nonce, { nonce, publicKey, createdAt: Date.now() });
  log.event("entity challenge created");
  return { nonce };
}

/**
 * Verifies a previously-issued entity challenge.
 * Consumes the challenge on success — single-use.
 */
export async function verifyEntityChallenge(
  publicKey: string,
  nonce: string,
  signature: string,
  deps: { log: Logger },
): Promise<boolean> {
  const log = deps.log.scope("verifyEntityChallenge");
  log.info("verifyEntityChallenge");

  const challenge = pending.get(nonce);
  if (!challenge) {
    log.event("challenge not found");
    return false;
  }
  if (Date.now() - challenge.createdAt > challengeTtlMs) {
    pending.delete(nonce);
    log.event("challenge expired");
    return false;
  }
  if (challenge.publicKey !== publicKey) {
    log.event("challenge publicKey mismatch");
    return false;
  }

  pending.delete(nonce);

  const ok = await verifyStellarSignature(publicKey, nonce, signature);
  log.debug("signatureValid", ok);
  return ok;
}

function cleanupExpired(): void {
  const now = Date.now();
  for (const [nonce, c] of pending) {
    if (now - c.createdAt > challengeTtlMs) pending.delete(nonce);
  }
}

// Test seam.
export function _resetEntityChallengesForTests(): void {
  pending.clear();
}
