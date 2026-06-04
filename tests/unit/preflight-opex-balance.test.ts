import { assertEquals, assertExists, assertThrows } from "@std/assert";
import {
  computePreflightResult,
  type PreflightResult,
  toInsufficientFeesDetail,
} from "@/core/service/executor/preflight-opex-balance.ts";
import { InsufficientFees } from "@/core/service/executor/executor.errors.ts";

const PUBKEY = "GAAAA000000000000000000000000000000000000000000000000000";
const BASE_RESERVE = BigInt(5_000_000); // 0.5 XLM in stroops
const BASE_INCLUSION = BigInt(100); // tx-level inclusion fee
const MIN_RESOURCE = BigInt(200); // soroban resource fee

function compute(
  balance: bigint,
  subentries: bigint,
): PreflightResult {
  return computePreflightResult({
    feePayerPubkey: PUBKEY,
    balanceStroops: balance,
    numSubEntries: subentries,
    baseReserveStroops: BASE_RESERVE,
    baseInclusionFeeStroops: BASE_INCLUSION,
    minResourceFeeStroops: MIN_RESOURCE,
  });
}

Deno.test("preflight math — sufficient funds: shortfall is negative", () => {
  // 2 + 0 subentries × 5M stroops = 10M reserves
  // required = 100 + 200 = 300
  // available = 100_000_000 - 10_000_000 = 90_000_000
  // shortfall = 300 - 90_000_000 = -89_999_700
  const r = compute(BigInt(100_000_000), BigInt(0));
  assertEquals(r.feePayerPubkey, PUBKEY);
  assertEquals(r.availableXlmStroops, BigInt(90_000_000));
  assertEquals(r.requiredXlmStroops, BigInt(300));
  assertEquals(r.shortfallStroops, BigInt(-89_999_700));
});

Deno.test("preflight math — exact match: shortfall is zero", () => {
  // 2 subentries → 4 × 5M = 20M reserves
  // available = 20_000_300 - 20_000_000 = 300
  // required = 300
  // shortfall = 0
  const r = compute(BigInt(20_000_300), BigInt(2));
  assertEquals(r.availableXlmStroops, BigInt(300));
  assertEquals(r.requiredXlmStroops, BigInt(300));
  assertEquals(r.shortfallStroops, BigInt(0));
});

Deno.test("preflight math — shortfall by one stroop", () => {
  // available = 20_000_299, required = 300 → shortfall = 1
  const r = compute(BigInt(20_000_299), BigInt(2));
  assertEquals(r.availableXlmStroops, BigInt(299));
  assertEquals(r.shortfallStroops, BigInt(1));
});

Deno.test("preflight math — empty account: full required is the shortfall plus reserve", () => {
  // balance = 0, subentries = 0 → reserves = 10M, available = -10M
  // required = 300, shortfall = 300 - (-10M) = 10M + 300
  const r = compute(BigInt(0), BigInt(0));
  assertEquals(r.availableXlmStroops, BigInt(-10_000_000));
  assertEquals(r.shortfallStroops, BigInt(10_000_300));
});

Deno.test("preflight math — high subentry count reduces available accordingly", () => {
  // subentries = 10 → reserves = 12 × 5M = 60M
  // available = 100M - 60M = 40M
  const r = compute(BigInt(100_000_000), BigInt(10));
  assertEquals(r.availableXlmStroops, BigInt(40_000_000));
});

Deno.test("toInsufficientFeesDetail — serialises stroops as strings", () => {
  const r = compute(BigInt(20_000_299), BigInt(2));
  const detail = toInsufficientFeesDetail(r);
  assertEquals(detail.feePayerPubkey, PUBKEY);
  assertEquals(detail.availableXlm, "299");
  assertEquals(detail.requiredXlm, "300");
  assertEquals(detail.shortfallXlm, "1");
});

Deno.test("InsufficientFees error carries the structured detail", () => {
  const detail = {
    feePayerPubkey: PUBKEY,
    availableXlm: "299",
    requiredXlm: "300",
    shortfallXlm: "1",
  };
  const err = new InsufficientFees(detail);
  assertEquals(err.code, "EXC_005");
  assertEquals(err.detail, detail);
  assertEquals(err.meta, detail);
  assertExists(err.message);
  // PlatformError exposes details string with the four numbers visible
  assertExists(err.details);
});

Deno.test("InsufficientFees instanceof works for catch-site type guard", () => {
  const detail = {
    feePayerPubkey: PUBKEY,
    availableXlm: "0",
    requiredXlm: "10000300",
    shortfallXlm: "10000300",
  };
  const err = new InsufficientFees(detail);
  // Verifies the catch-site fast-path `error instanceof InsufficientFees`
  // works under v8.
  assertEquals(err instanceof InsufficientFees, true);
  assertEquals(err instanceof Error, true);
  // Force a throw + catch round-trip to mimic executor.process.ts behaviour
  assertThrows(
    () => {
      throw err;
    },
    InsufficientFees,
    "Insufficient fees",
  );
});
