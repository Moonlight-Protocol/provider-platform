import { Keypair } from "stellar-sdk";
import { Buffer } from "buffer";

export interface SignedPayload<T> {
  payload: T;
  signature: string;
  publicKey: string;
  timestamp: number;
}

const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Signs a JSON payload with an Ed25519 Stellar secret key.
 * Includes a timestamp for replay protection.
 * Produces: SHA-256(JSON.stringify({payload, timestamp})) → Ed25519 sign → base64.
 */
export async function signPayload<T>(payload: T, secretKey: string): Promise<SignedPayload<T>> {
  const keypair = Keypair.fromSecret(secretKey);
  const timestamp = Date.now();
  const canonical = JSON.stringify({ payload, timestamp });
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)),
  );
  const signature = Buffer.from(keypair.sign(Buffer.from(hash))).toString("base64");

  return {
    payload,
    signature,
    publicKey: keypair.publicKey(),
    timestamp,
  };
}

/**
 * Verifies a signed payload against the embedded public key.
 * Checks signature validity and timestamp freshness (max 5 minutes).
 */
export async function verifyPayload<T>(envelope: SignedPayload<T>, maxAgeMs = MAX_AGE_MS): Promise<boolean> {
  try {
    // Check timestamp freshness
    if (!envelope.timestamp || Math.abs(Date.now() - envelope.timestamp) > maxAgeMs) {
      return false;
    }

    const keypair = Keypair.fromPublicKey(envelope.publicKey);
    const canonical = JSON.stringify({ payload: envelope.payload, timestamp: envelope.timestamp });
    const hash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)),
    );
    const sigBuffer = Buffer.from(envelope.signature, "base64");
    return keypair.verify(Buffer.from(hash), sigBuffer);
  } catch {
    return false;
  }
}
