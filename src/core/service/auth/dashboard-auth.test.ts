import { assertEquals, assertRejects } from "@std/assert";
import { newNoop } from "@/utils/logger/index.ts";
import { Keypair } from "stellar-sdk";
import { Buffer } from "buffer";
import {
  createDashboardChallenge,
  type DashboardAuthConfig,
  verifyDashboardChallenge,
} from "./dashboard-auth.ts";

const TEST_KEYPAIR = Keypair.random();
const TEST_PUBLIC_KEY = TEST_KEYPAIR.publicKey();

// deno-lint-ignore require-await -- mock satisfies generateToken's Promise<string> contract
const mockGenerateToken = async (sub: string, _sid: string) =>
  `mock-jwt-${sub.slice(0, 8)}`;

// Config where the signer IS the provider (direct match, no Horizon needed)
const SELF_SIGNER_CONFIG: DashboardAuthConfig = {
  providerPublicKey: TEST_PUBLIC_KEY,
  generateToken: mockGenerateToken,
};

// Config where the signer is NOT the provider (and no Horizon to check multisig)
const DIFFERENT_PROVIDER_CONFIG: DashboardAuthConfig = {
  providerPublicKey: Keypair.random().publicKey(),
  generateToken: mockGenerateToken,
};

function signNonce(keypair: typeof TEST_KEYPAIR, nonce: string): string {
  const nonceBuffer = Buffer.from(nonce, "base64");
  const sigBuffer = keypair.sign(nonceBuffer);
  return sigBuffer.toString("base64");
}

async function signNonceSep53(
  keypair: typeof TEST_KEYPAIR,
  nonce: string,
): Promise<string> {
  const prefix = "Stellar Signed Message:\n";
  const prefixedMessage = Buffer.concat([
    Buffer.from(prefix, "utf-8"),
    Buffer.from(nonce, "utf-8"),
  ]);
  const hash = Buffer.from(
    await crypto.subtle.digest("SHA-256", prefixedMessage),
  );
  const sigBuffer = keypair.sign(hash);
  return sigBuffer.toString("hex");
}

Deno.test("createDashboardChallenge - returns a nonce", () => {
  const { nonce } = createDashboardChallenge(TEST_PUBLIC_KEY, {
    log: newNoop(),
  });
  assertEquals(typeof nonce, "string");
  assertEquals(nonce.length > 0, true);
});

Deno.test("createDashboardChallenge - returns unique nonces", () => {
  const { nonce: nonce1 } = createDashboardChallenge(TEST_PUBLIC_KEY, {
    log: newNoop(),
  });
  const { nonce: nonce2 } = createDashboardChallenge(TEST_PUBLIC_KEY, {
    log: newNoop(),
  });
  assertEquals(nonce1 !== nonce2, true);
});

Deno.test("verifyDashboardChallenge - rejects unknown nonce", async () => {
  await assertRejects(
    () =>
      verifyDashboardChallenge(
        "unknown-nonce",
        "sig",
        TEST_PUBLIC_KEY,
        SELF_SIGNER_CONFIG,
        { log: newNoop() },
      ),
    Error,
    "Challenge not found",
  );
});

Deno.test("verifyDashboardChallenge - rejects wrong public key", async () => {
  const { nonce } = createDashboardChallenge(TEST_PUBLIC_KEY, {
    log: newNoop(),
  });
  const otherKey = Keypair.random().publicKey();

  await assertRejects(
    () =>
      verifyDashboardChallenge(nonce, "sig", otherKey, SELF_SIGNER_CONFIG, {
        log: newNoop(),
      }),
    Error,
    "Public key mismatch",
  );
});

Deno.test("verifyDashboardChallenge - rejects short invalid signature", async () => {
  const { nonce } = createDashboardChallenge(TEST_PUBLIC_KEY, {
    log: newNoop(),
  });
  const badSig = btoa("too-short");

  await assertRejects(
    () =>
      verifyDashboardChallenge(
        nonce,
        badSig,
        TEST_PUBLIC_KEY,
        SELF_SIGNER_CONFIG,
        { log: newNoop() },
      ),
    Error,
    "Invalid signature",
  );
});

Deno.test("verifyDashboardChallenge - rejects valid-length but wrong signature", async () => {
  const { nonce } = createDashboardChallenge(TEST_PUBLIC_KEY, {
    log: newNoop(),
  });
  // 64-byte signature that's properly sized but wrong
  const wrongSig = signNonce(Keypair.random(), nonce);

  await assertRejects(
    () =>
      verifyDashboardChallenge(
        nonce,
        wrongSig,
        TEST_PUBLIC_KEY,
        SELF_SIGNER_CONFIG,
        { log: newNoop() },
      ),
    Error,
    "Invalid signature",
  );
});

Deno.test("verifyDashboardChallenge - valid signature + self signer = success", async () => {
  const { nonce } = createDashboardChallenge(TEST_PUBLIC_KEY, {
    log: newNoop(),
  });
  const signature = signNonce(TEST_KEYPAIR, nonce);

  const { token } = await verifyDashboardChallenge(
    nonce,
    signature,
    TEST_PUBLIC_KEY,
    SELF_SIGNER_CONFIG,
    { log: newNoop() },
  );

  assertEquals(typeof token, "string");
  assertEquals(token.length > 0, true);
});

Deno.test("verifyDashboardChallenge - valid signature + different provider (no Horizon) = rejected", async () => {
  const { nonce } = createDashboardChallenge(TEST_PUBLIC_KEY, {
    log: newNoop(),
  });
  const signature = signNonce(TEST_KEYPAIR, nonce);

  await assertRejects(
    () =>
      verifyDashboardChallenge(
        nonce,
        signature,
        TEST_PUBLIC_KEY,
        DIFFERENT_PROVIDER_CONFIG,
        { log: newNoop() },
      ),
    Error,
    "Signer is not authorized",
  );
});

Deno.test("verifyDashboardChallenge - SEP-53 hex signature + self signer = success", async () => {
  const { nonce } = createDashboardChallenge(TEST_PUBLIC_KEY, {
    log: newNoop(),
  });
  const signature = await signNonceSep53(TEST_KEYPAIR, nonce);

  const { token } = await verifyDashboardChallenge(
    nonce,
    signature,
    TEST_PUBLIC_KEY,
    SELF_SIGNER_CONFIG,
    { log: newNoop() },
  );

  assertEquals(typeof token, "string");
  assertEquals(token.length > 0, true);
});

Deno.test("verifyDashboardChallenge - SEP-53 wrong key rejected", async () => {
  const { nonce } = createDashboardChallenge(TEST_PUBLIC_KEY, {
    log: newNoop(),
  });
  const signature = await signNonceSep53(Keypair.random(), nonce);

  await assertRejects(
    () =>
      verifyDashboardChallenge(
        nonce,
        signature,
        TEST_PUBLIC_KEY,
        SELF_SIGNER_CONFIG,
        { log: newNoop() },
      ),
    Error,
    "Invalid signature",
  );
});

Deno.test("verifyDashboardChallenge - nonce is consumed after use", async () => {
  const { nonce } = createDashboardChallenge(TEST_PUBLIC_KEY, {
    log: newNoop(),
  });
  const signature = signNonce(TEST_KEYPAIR, nonce);

  // First use succeeds
  await verifyDashboardChallenge(
    nonce,
    signature,
    TEST_PUBLIC_KEY,
    SELF_SIGNER_CONFIG,
    { log: newNoop() },
  );

  // Second use fails
  await assertRejects(
    () =>
      verifyDashboardChallenge(
        nonce,
        signature,
        TEST_PUBLIC_KEY,
        SELF_SIGNER_CONFIG,
        { log: newNoop() },
      ),
    Error,
    "Challenge not found",
  );
});
