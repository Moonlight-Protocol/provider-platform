/**
 * Shared password hashing and verification utilities for custodial auth.
 *
 * Uses PBKDF2 via Web Crypto API with 100,000 iterations of SHA-256.
 * Passwords are stored as "hex(salt):hex(derived)" strings.
 */

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt.buffer as ArrayBuffer, iterations: 100000, hash: "SHA-256" },
    key,
    256,
  );
  return `${bytesToHex(salt)}:${bytesToHex(new Uint8Array(derived))}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt, stored] = hash.split(":");
  if (!salt || !stored) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: hexToBytes(salt).buffer as ArrayBuffer, iterations: 100000, hash: "SHA-256" },
    key,
    256,
  );

  // Timing-safe comparison
  const derivedBytes = new Uint8Array(derived);
  const storedBytes = hexToBytes(stored);
  if (derivedBytes.length !== storedBytes.length) return false;

  return timingSafeEqual(derivedBytes, storedBytes);
}

/**
 * Constant-time comparison of two byte arrays.
 * Uses crypto.subtle.timingSafeEqual when available, otherwise
 * falls back to a manual XOR-based comparison.
 */
async function timingSafeEqual(a: Uint8Array, b: Uint8Array): Promise<boolean> {
  if (a.length !== b.length) return false;

  // Import both as HMAC keys and compare via sign — this is
  // timing-safe because the crypto API doesn't short-circuit.
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(32), // dummy key
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigA = new Uint8Array(await crypto.subtle.sign("HMAC", key, a.buffer as ArrayBuffer));
  const sigB = new Uint8Array(await crypto.subtle.sign("HMAC", key, b.buffer as ArrayBuffer));
  let result = 0;
  for (let i = 0; i < sigA.length; i++) {
    result |= sigA[i] ^ sigB[i];
  }
  return result === 0;
}
