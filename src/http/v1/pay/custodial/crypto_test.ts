import { assertEquals, assertNotEquals } from "@std/assert";
import {
  bytesToHex,
  hashPassword,
  hexToBytes,
  verifyPassword,
} from "./crypto.ts";

// --- bytesToHex / hexToBytes ---

Deno.test("bytesToHex - known values", () => {
  assertEquals(bytesToHex(new Uint8Array([0x00])), "00");
  assertEquals(bytesToHex(new Uint8Array([0xff])), "ff");
  assertEquals(
    bytesToHex(new Uint8Array([0xde, 0xad, 0xbe, 0xef])),
    "deadbeef",
  );
  assertEquals(bytesToHex(new Uint8Array([1, 2, 3])), "010203");
});

Deno.test("bytesToHex - empty array", () => {
  assertEquals(bytesToHex(new Uint8Array([])), "");
});

Deno.test("hexToBytes - known values", () => {
  assertEquals(hexToBytes("00"), new Uint8Array([0x00]));
  assertEquals(hexToBytes("ff"), new Uint8Array([0xff]));
  assertEquals(
    hexToBytes("deadbeef"),
    new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
  );
  assertEquals(hexToBytes("010203"), new Uint8Array([1, 2, 3]));
});

Deno.test("hexToBytes - empty string", () => {
  assertEquals(hexToBytes(""), new Uint8Array([]));
});

Deno.test("bytesToHex / hexToBytes - round-trip consistency", () => {
  const original = new Uint8Array([0, 1, 127, 128, 255, 16, 32]);
  const hex = bytesToHex(original);
  const roundTripped = hexToBytes(hex);
  assertEquals(roundTripped, original);
});

Deno.test("hexToBytes / bytesToHex - round-trip from hex string", () => {
  const hex = "0a1b2c3d4e5f";
  const bytes = hexToBytes(hex);
  const roundTripped = bytesToHex(bytes);
  assertEquals(roundTripped, hex);
});

// --- hashPassword ---

Deno.test("hashPassword - returns salt:derived format", async () => {
  const hash = await hashPassword("test-password");
  const parts = hash.split(":");
  assertEquals(parts.length, 2, "Hash must be in 'salt:derived' format");
});

Deno.test("hashPassword - salt is 16 bytes (32 hex chars)", async () => {
  const hash = await hashPassword("test-password");
  const [salt] = hash.split(":");
  assertEquals(salt.length, 32, "Salt should be 32 hex characters (16 bytes)");
  // Verify it's valid hex
  assertEquals(/^[0-9a-f]+$/.test(salt), true, "Salt should be lowercase hex");
});

Deno.test("hashPassword - derived key is 32 bytes (64 hex chars)", async () => {
  const hash = await hashPassword("test-password");
  const [_, derived] = hash.split(":");
  assertEquals(
    derived.length,
    64,
    "Derived key should be 64 hex characters (32 bytes)",
  );
  assertEquals(
    /^[0-9a-f]+$/.test(derived),
    true,
    "Derived key should be lowercase hex",
  );
});

Deno.test("hashPassword - different calls produce different salts", async () => {
  const hash1 = await hashPassword("same-password");
  const hash2 = await hashPassword("same-password");
  const salt1 = hash1.split(":")[0];
  const salt2 = hash2.split(":")[0];
  assertNotEquals(salt1, salt2, "Salts should differ between calls (random)");
});

Deno.test("hashPassword - same password produces different hashes", async () => {
  const hash1 = await hashPassword("same-password");
  const hash2 = await hashPassword("same-password");
  assertNotEquals(hash1, hash2, "Hashes should differ due to random salt");
});

// --- verifyPassword ---

Deno.test("verifyPassword - correct password returns true", async () => {
  const password = "my-secure-password";
  const hash = await hashPassword(password);
  const result = await verifyPassword(password, hash);
  assertEquals(result, true);
});

Deno.test("verifyPassword - wrong password returns false", async () => {
  const hash = await hashPassword("correct-password");
  const result = await verifyPassword("wrong-password", hash);
  assertEquals(result, false);
});

Deno.test("verifyPassword - malformed hash (no colon) returns false", async () => {
  const result = await verifyPassword("password", "nocolonhere");
  assertEquals(result, false);
});

Deno.test("verifyPassword - empty hash returns false", async () => {
  const result = await verifyPassword("password", "");
  assertEquals(result, false);
});

Deno.test("verifyPassword - both correct and wrong password complete without throwing", async () => {
  const password = "timing-test-pw";
  const hash = await hashPassword(password);

  // Both calls should complete without error
  const correctResult = await verifyPassword(password, hash);
  const wrongResult = await verifyPassword("wrong-pw", hash);
  assertEquals(correctResult, true);
  assertEquals(wrongResult, false);
});
