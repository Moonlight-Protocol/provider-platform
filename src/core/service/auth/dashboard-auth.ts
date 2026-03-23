import { Keypair } from "stellar-sdk";
import { Buffer } from "buffer";
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

    // 2. Verify Ed25519 signature (supports both SEP-53 and raw formats)
    span.addEvent("verifying_signature");
    try {
      const keypair = Keypair.fromPublicKey(publicKey);

      // Decode signature — try hex first (SEP-53 / signMessage), then base64 (raw)
      const sigBuffer = /^[0-9a-f]+$/i.test(signature)
        ? Buffer.from(signature, "hex")
        : Buffer.from(signature, "base64");

      const nonceBytes = Buffer.from(nonce, "utf-8");

      // Try SEP-43 format (Freighter signMessage):
      // sign(SHA256(0x00 0x00 || len(message) as 4-byte BE || message))
      const sep43Header = Buffer.alloc(6);
      sep43Header[0] = 0x00; // version
      sep43Header[1] = 0x00;
      sep43Header.writeUInt32BE(nonceBytes.length, 2);
      const sep43Payload = Buffer.concat([sep43Header, nonceBytes]);
      const sep43Hash = Buffer.from(
        await crypto.subtle.digest("SHA-256", sep43Payload),
      );

      if (keypair.verify(sep43Hash, sigBuffer)) {
        span.addEvent("signature_verified_sep43");
      } else {
        // Try SEP-53 format: sign(SHA256("Stellar Signed Message:\n" + message))
        const sep53Prefix = "Stellar Signed Message:\n";
        const sep53Payload = Buffer.concat([
          Buffer.from(sep53Prefix, "utf-8"),
          nonceBytes,
        ]);
        const sep53Hash = Buffer.from(
          await crypto.subtle.digest("SHA-256", sep53Payload),
        );

        if (keypair.verify(sep53Hash, sigBuffer)) {
          span.addEvent("signature_verified_sep53");
        } else {
          // Fall back to raw signature over nonce bytes (E2E / SDK flow)
          const rawNonce = Buffer.from(nonce, "base64");
          if (!keypair.verify(rawNonce, sigBuffer)) {
            throw new Error("Invalid signature");
          }
          span.addEvent("signature_verified_raw");
        }
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

    // 4. Issue JWT — hash nonce so raw challenge material isn't in the token
    span.addEvent("issuing_jwt");
    const hashBytes = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce))
    );
    const hashedSessionId = Array.from(hashBytes.slice(0, 16))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const token = await config.generateToken(publicKey, hashedSessionId);

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
