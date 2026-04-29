import { MODE, SERVICE_AUTH_SECRET } from "@/config/env.ts";

function generateSecret() {
  // Generate 32 random bytes
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  // Convert the bytes to a base64-encoded string for storage or use
  const secret = btoa(String.fromCharCode(...randomBytes));
  return secret;
}

if (!SERVICE_AUTH_SECRET) {
  if (MODE === "production") {
    throw new Error(
      "SERVICE_AUTH_SECRET must be set in production. A random secret would invalidate all JWTs on restart.",
    );
  }
  console.warn(
    "WARNING: SERVICE_AUTH_SECRET is not set. Generating a random secret. This is NOT recommended for production environments.",
  );
}

export const authSecret = SERVICE_AUTH_SECRET || generateSecret();

async function importSecret(secret: string, isSignable?: boolean) {
  const keyData = new TextEncoder().encode(secret);
  return await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" } as const,
    false,
    ["verify" as const, ...(isSignable ? ["sign" as const] : [])],
  );
}

export const SERVICE_AUTH_SECRET_AS_CRYPTO_KEY = await importSecret(authSecret);
export const SERVICE_AUTH_SECRET_AS_CRYPTO_KEY_SIGNABLE = await importSecret(
  authSecret,
  true,
);
