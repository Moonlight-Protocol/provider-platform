import { Keypair } from "stellar-sdk";
import { LOG } from "@/config/logger.ts";
import { withSpan } from "@/core/tracing.ts";

/**
 * In-memory challenge store for dashboard auth.
 * Max 1000 pending challenges.
 */
const MAX_PENDING_CHALLENGES = 1000;

let challengeTtlMs = 5 * 60 * 1000; // default 5 minutes

/**
 * Configure the challenge TTL. Call at startup with the value from env.
 */
export function setChallengeTtlMs(ttlMs: number): void {
  challengeTtlMs = ttlMs;
}

interface PendingChallenge {
  nonce: string;
  publicKey: string;
  createdAt: number;
}

const pendingChallenges = new Map<string, PendingChallenge>();

/**
 * Creates a challenge for dashboard authentication.
 *
 * @param publicKey - The Ed25519 public key of the operator requesting auth
 * @returns The nonce to be signed
 */
export function createDashboardChallenge(publicKey: string): { nonce: string } {
  cleanupExpiredChallenges();

  if (pendingChallenges.size >= MAX_PENDING_CHALLENGES) {
    throw new Error("Too many pending challenges. Try again later.");
  }

  const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = btoa(String.fromCharCode(...nonceBytes));

  pendingChallenges.set(nonce, {
    nonce,
    publicKey,
    createdAt: Date.now(),
  });

  LOG.debug("Dashboard challenge created", { publicKey });

  return { nonce };
}

/**
 * Configuration for verifying a dashboard challenge.
 * Injected so the service is testable without loading env.
 */
export interface DashboardAuthConfig {
  providerPublicKey: string;
  horizonUrl?: string;
  /** JWT generator function — injected so the module doesn't depend on env.ts */
  generateToken: (subject: string, sessionId: string) => Promise<string>;
}

/**
 * Verifies a signed dashboard challenge.
 *
 * 1. Checks the nonce exists and hasn't expired
 * 2. Verifies the Ed25519 signature over the nonce
 * 3. Checks the signer is authorized on the PP's Stellar account
 * 4. Returns a JWT session token
 */
export async function verifyDashboardChallenge(
  nonce: string,
  signature: string,
  publicKey: string,
  config: DashboardAuthConfig,
): Promise<{ token: string }> {
  return withSpan("DashboardAuth.verify", async (span) => {
    span.addEvent("verifying_challenge", { "signer.publicKey": publicKey });

    // 1. Check nonce exists
    const challenge = pendingChallenges.get(nonce);
    if (!challenge) {
      throw new Error("Challenge not found or expired");
    }

    // Check expiry
    if (Date.now() - challenge.createdAt > challengeTtlMs) {
      pendingChallenges.delete(nonce);
      throw new Error("Challenge expired");
    }

    // Check public key matches
    if (challenge.publicKey !== publicKey) {
      throw new Error("Public key mismatch");
    }

    // Consume the challenge (one-time use)
    pendingChallenges.delete(nonce);

    // 2. Verify Ed25519 signature
    span.addEvent("verifying_signature");
    try {
      const keypair = Keypair.fromPublicKey(publicKey);
      const nonceBuffer = Buffer.from(nonce, "base64");
      const sigBuffer = Buffer.from(signature, "base64");
      if (!keypair.verify(nonceBuffer, sigBuffer)) {
        throw new Error("Invalid signature");
      }
    } catch (e) {
      throw e instanceof Error && e.message === "Invalid signature"
        ? e
        : new Error("Invalid signature");
    }

    // 3. Check signer is authorized on the PP's Stellar account
    span.addEvent("checking_signer_authorization");
    const isAuth = await isAuthorizedSigner(
      publicKey,
      config.providerPublicKey,
      config.horizonUrl,
    );
    if (!isAuth) {
      throw new Error("Signer is not authorized on the provider account");
    }

    // 4. Issue JWT
    span.addEvent("issuing_jwt");
    const token = await config.generateToken(publicKey, nonce);

    LOG.info("Dashboard auth successful", { publicKey });
    return { token };
  });
}

/**
 * Checks if `signerKey` is an authorized signer on the `accountId` Stellar account.
 */
async function isAuthorizedSigner(
  signerKey: string,
  accountId: string,
  horizonUrl?: string,
): Promise<boolean> {
  // Direct match — the signer is the account itself
  if (signerKey === accountId) {
    return true;
  }

  if (!horizonUrl) {
    LOG.warn("No Horizon URL configured, falling back to direct key match only");
    return false;
  }

  try {
    const baseUrl = horizonUrl.replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}/accounts/${accountId}`);
    if (!response.ok) {
      LOG.error("Failed to fetch account from Horizon", {
        status: response.status,
        accountId,
      });
      return false;
    }

    const accountData = await response.json();
    const signers = accountData.signers as Array<{ key: string; weight: number }>;

    return signers.some((s) => s.key === signerKey && s.weight > 0);
  } catch (error) {
    LOG.error("Failed to verify signer authorization", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function cleanupExpiredChallenges(): void {
  const now = Date.now();
  for (const [nonce, challenge] of pendingChallenges) {
    if (now - challenge.createdAt > challengeTtlMs) {
      pendingChallenges.delete(nonce);
    }
  }
}
