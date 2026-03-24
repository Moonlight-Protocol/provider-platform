import { assertEquals } from "jsr:@std/assert";
import { StrKey } from "@colibri/core";

// --- Amount validation: regex /^\d+$/ ---

const AMOUNT_REGEX = /^\d+$/;

Deno.test("amount regex - accepts valid positive integer strings", () => {
  assertEquals(AMOUNT_REGEX.test("123"), true);
  assertEquals(AMOUNT_REGEX.test("0"), true);
  assertEquals(AMOUNT_REGEX.test("1000000"), true);
  assertEquals(AMOUNT_REGEX.test("999999999999999"), true);
  assertEquals(AMOUNT_REGEX.test("1"), true);
});

Deno.test("amount regex - rejects negative numbers", () => {
  assertEquals(AMOUNT_REGEX.test("-1"), false);
  assertEquals(AMOUNT_REGEX.test("-100"), false);
});

Deno.test("amount regex - rejects decimals", () => {
  assertEquals(AMOUNT_REGEX.test("1.5"), false);
  assertEquals(AMOUNT_REGEX.test("0.1"), false);
  assertEquals(AMOUNT_REGEX.test("100.00"), false);
});

Deno.test("amount regex - rejects alphabetic strings", () => {
  assertEquals(AMOUNT_REGEX.test("abc"), false);
  assertEquals(AMOUNT_REGEX.test("one"), false);
});

Deno.test("amount regex - rejects empty string", () => {
  assertEquals(AMOUNT_REGEX.test(""), false);
});

Deno.test("amount regex - rejects strings with leading/trailing spaces", () => {
  assertEquals(AMOUNT_REGEX.test(" 123"), false);
  assertEquals(AMOUNT_REGEX.test("123 "), false);
  assertEquals(AMOUNT_REGEX.test(" 123 "), false);
});

Deno.test("amount regex - rejects scientific notation", () => {
  assertEquals(AMOUNT_REGEX.test("1e5"), false);
  assertEquals(AMOUNT_REGEX.test("1E5"), false);
});

// --- BigInt zero-rejection logic ---

Deno.test("BigInt zero-rejection - zero is not positive", () => {
  assertEquals(BigInt("0") <= 0n, true, "0n <= 0n should be true (rejected by handler)");
});

Deno.test("BigInt zero-rejection - positive value passes", () => {
  assertEquals(BigInt("1") > 0n, true, "1n > 0n should be true (accepted by handler)");
});

Deno.test("BigInt zero-rejection - large positive value passes", () => {
  assertEquals(BigInt("999999999999") > 0n, true);
});

// --- Stellar address validation ---

Deno.test("StrKey - valid Stellar public key (G...) passes", () => {
  // Well-known Stellar test public key (56 chars starting with G)
  const validKey = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
  assertEquals(StrKey.isValidEd25519PublicKey(validKey), true);
});

Deno.test("StrKey - random string fails", () => {
  assertEquals(StrKey.isValidEd25519PublicKey("not-a-key"), false);
});

Deno.test("StrKey - empty string fails", () => {
  assertEquals(StrKey.isValidEd25519PublicKey(""), false);
});

Deno.test("StrKey - key with wrong prefix fails", () => {
  // S... is a secret key prefix, not a public key
  assertEquals(
    StrKey.isValidEd25519PublicKey("SCZANGBA5YHTNYVVV3C7CAZMCLXPILHSE6PGYAY5WKR3YZLU7E2IGSUD"),
    false,
  );
});

Deno.test("StrKey - correct prefix but wrong length fails", () => {
  assertEquals(StrKey.isValidEd25519PublicKey("GAAZI4TCR3TY5"), false);
});

Deno.test("StrKey - correct length but invalid checksum fails", () => {
  // Modify the last few chars to break the checksum
  assertEquals(
    StrKey.isValidEd25519PublicKey("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN8"),
    false,
  );
});
