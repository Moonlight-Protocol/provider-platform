/**
 * Symmetric encryption for storing PP secret keys at rest.
 * Uses AES-256-GCM with a key derived from SERVICE_AUTH_SECRET via PBKDF2.
 *
 * Encrypted output format: base64(salt[16] + iv[12] + ciphertext)
 */

const SALT_LENGTH = 16;
const IV_LENGTH = 12;

async function deriveKey(secret: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptSk(plaintext: string, secret: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const key = await deriveKey(secret, salt);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)),
  );
  // Concatenate salt + iv + ciphertext and base64-encode
  const combined = new Uint8Array(salt.length + iv.length + encrypted.length);
  combined.set(salt);
  combined.set(iv, salt.length);
  combined.set(encrypted, salt.length + iv.length);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptSk(ciphertext: string, secret: string): Promise<string> {
  const combined = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
  const salt = combined.slice(0, SALT_LENGTH);
  const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const encrypted = combined.slice(SALT_LENGTH + IV_LENGTH);
  const key = await deriveKey(secret, salt);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
  return new TextDecoder().decode(decrypted);
}
