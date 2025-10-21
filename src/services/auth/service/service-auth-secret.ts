function generateSecret() {
  // Generate 32 random bytes
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  // Convert the bytes to a base64-encoded string for storage or use
  const secret = btoa(String.fromCharCode(...randomBytes));
  return secret;
}

export const SERVICE_AUTH_SECRET = generateSecret();

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

export const SERVICE_AUTH_SECRET_AS_CRYPTO_KEY = await importSecret(
  SERVICE_AUTH_SECRET,
);
export const SERVICE_AUTH_SECRET_AS_CRYPTO_KEY_SIGNABLE = await importSecret(
  SERVICE_AUTH_SECRET,
  true,
);
