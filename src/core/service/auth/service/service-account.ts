import { LocalSigner } from "@colibri/core";
import { Keypair } from "stellar-sdk";
import { Buffer } from "buffer";
import { SERVICE_AUTH_SECRET } from "@/config/env.ts";

let _authSigner: LocalSigner | null = null;

/**
 * Returns the platform's auth signer — used for SEP-10 style challenge signing.
 * Derived deterministically from SERVICE_AUTH_SECRET so the keypair is stable
 * across restarts without needing a separate env var.
 */
export function getProviderAccount(): LocalSigner {
  if (!_authSigner) {
    const encoder = new TextEncoder();
    const secretBytes = encoder.encode(SERVICE_AUTH_SECRET + ":auth-challenge-keypair");
    const seed = new Uint8Array(32);
    for (let i = 0; i < secretBytes.length; i++) {
      seed[i % 32] ^= secretBytes[i];
    }
    const keypair = Keypair.fromRawEd25519Seed(Buffer.from(seed));
    _authSigner = LocalSigner.fromSecret(keypair.secret() as `S${string}`);
  }
  return _authSigner;
}
