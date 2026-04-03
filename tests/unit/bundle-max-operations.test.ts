import { assertEquals, assertInstanceOf } from "jsr:@std/assert";
import { z } from "zod";
import { PlatformError } from "@/error/index.ts";
import {
  TOO_MANY_OPERATIONS,
  BUNDLE_ERROR_CODES,
} from "@/core/service/bundle/bundle.errors.ts";

// ---------------------------------------------------------------------------
// Schema validation: operationsMLXDR .min(1).max(MAX)
//
// Both post.ts and post.schema.ts use the same Zod pattern:
//   z.array(z.string()).min(1).max(BUNDLE_MAX_OPERATIONS)
//
// We replicate the schema with a known MAX to test boundary behaviour
// without importing env.ts (which eagerly validates all production env vars).
// ---------------------------------------------------------------------------

const TEST_MAX = 20;

const operationsSchema = z.object({
  operationsMLXDR: z.array(z.string()).min(1).max(TEST_MAX),
});

function ops(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `op-${i}`);
}

// ---------------------------------------------------------------------------
// Schema: lower bound (.min(1))
// ---------------------------------------------------------------------------

Deno.test("schema – rejects empty operationsMLXDR array", () => {
  const result = operationsSchema.safeParse({ operationsMLXDR: [] });
  assertEquals(result.success, false);
});

Deno.test("schema – accepts single operation", () => {
  const result = operationsSchema.safeParse({ operationsMLXDR: ["op-0"] });
  assertEquals(result.success, true);
});

// ---------------------------------------------------------------------------
// Schema: upper bound (.max(BUNDLE_MAX_OPERATIONS))
// ---------------------------------------------------------------------------

Deno.test("schema – accepts exactly MAX operations", () => {
  const result = operationsSchema.safeParse({ operationsMLXDR: ops(TEST_MAX) });
  assertEquals(result.success, true);
});

Deno.test("schema – rejects MAX + 1 operations", () => {
  const result = operationsSchema.safeParse({ operationsMLXDR: ops(TEST_MAX + 1) });
  assertEquals(result.success, false);
});

Deno.test("schema – rejects significantly over MAX operations", () => {
  const result = operationsSchema.safeParse({ operationsMLXDR: ops(TEST_MAX * 5) });
  assertEquals(result.success, false);
});

Deno.test("schema – error message references the maximum", () => {
  const result = operationsSchema.safeParse({ operationsMLXDR: ops(TEST_MAX + 1) });
  assertEquals(result.success, false);
  if (!result.success) {
    const issue = result.error.issues[0];
    assertEquals(issue.code, "too_big");
    assertEquals(issue.path, ["operationsMLXDR"]);
  }
});

// ---------------------------------------------------------------------------
// TOO_MANY_OPERATIONS error class
// ---------------------------------------------------------------------------

Deno.test("TOO_MANY_OPERATIONS – is a PlatformError", () => {
  const err = new TOO_MANY_OPERATIONS(25, 20);
  assertInstanceOf(err, PlatformError);
  assertInstanceOf(err, Error);
});

Deno.test("TOO_MANY_OPERATIONS – has correct error code", () => {
  const err = new TOO_MANY_OPERATIONS(25, 20);
  assertEquals(err.code, BUNDLE_ERROR_CODES.TOO_MANY_OPERATIONS);
  assertEquals(err.code, "BND_010");
});

Deno.test("TOO_MANY_OPERATIONS – meta contains received and max", () => {
  const err = new TOO_MANY_OPERATIONS(30, 20);
  assertEquals(err.meta, { received: 30, max: 20 });
});

Deno.test("TOO_MANY_OPERATIONS – API response is 400 with limit info", () => {
  const err = new TOO_MANY_OPERATIONS(25, 20);
  assertEquals(err.hasAPIError(), true);

  const apiErr = err.getAPIError();
  assertEquals(apiErr.status, 400);
  assertEquals(apiErr.details?.includes("20"), true);
  assertEquals(apiErr.details?.includes("25"), true);
});

Deno.test("TOO_MANY_OPERATIONS – details include both counts", () => {
  const err = new TOO_MANY_OPERATIONS(50, 20);
  assertEquals(err.details!.includes("50"), true);
  assertEquals(err.details!.includes("20"), true);
});

// ---------------------------------------------------------------------------
// Env validation logic: BUNDLE_MAX_OPERATIONS parsing guard
//
// Mirrors the inline-guard pattern used in bundle-admin.test.ts.
// The production code in env.ts does:
//   if (!Number.isFinite(v) || !Number.isInteger(v) || v < 1) throw ...
// ---------------------------------------------------------------------------

function isValidBundleMaxOps(raw: string): boolean {
  const v = Number(raw);
  return Number.isFinite(v) && Number.isInteger(v) && v >= 1;
}

Deno.test("env guard – rejects non-numeric string", () => {
  assertEquals(isValidBundleMaxOps("abc"), false);
});

Deno.test("env guard – rejects empty string", () => {
  assertEquals(isValidBundleMaxOps(""), false);
});

Deno.test("env guard – rejects zero", () => {
  assertEquals(isValidBundleMaxOps("0"), false);
});

Deno.test("env guard – rejects negative integer", () => {
  assertEquals(isValidBundleMaxOps("-5"), false);
});

Deno.test("env guard – rejects fractional number", () => {
  assertEquals(isValidBundleMaxOps("3.5"), false);
});

Deno.test("env guard – rejects Infinity", () => {
  assertEquals(isValidBundleMaxOps("Infinity"), false);
});

Deno.test("env guard – rejects NaN", () => {
  assertEquals(isValidBundleMaxOps("NaN"), false);
});

Deno.test("env guard – accepts '1'", () => {
  assertEquals(isValidBundleMaxOps("1"), true);
});

Deno.test("env guard – accepts '20'", () => {
  assertEquals(isValidBundleMaxOps("20"), true);
});

Deno.test("env guard – accepts '100'", () => {
  assertEquals(isValidBundleMaxOps("100"), true);
});
