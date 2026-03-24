import { assertEquals } from "jsr:@std/assert";
import { PayTransactionStatus } from "@/persistence/drizzle/entity/pay-transaction.entity.ts";

/**
 * Tests for PayTransactionStatus enum validation logic from transactions/list.ts.
 *
 * The handler creates a Set from the enum values and validates the status
 * query parameter against it:
 *   const validStatuses = new Set<string>(Object.values(PayTransactionStatus));
 *   if (statusParam && !validStatuses.has(statusParam)) { reject }
 */

const validStatuses = new Set<string>(Object.values(PayTransactionStatus));

// --- Valid status values ---

Deno.test("PayTransactionStatus - PENDING is a valid status", () => {
  assertEquals(validStatuses.has("PENDING"), true);
});

Deno.test("PayTransactionStatus - COMPLETED is a valid status", () => {
  assertEquals(validStatuses.has("COMPLETED"), true);
});

Deno.test("PayTransactionStatus - FAILED is a valid status", () => {
  assertEquals(validStatuses.has("FAILED"), true);
});

Deno.test("PayTransactionStatus - EXPIRED is a valid status", () => {
  assertEquals(validStatuses.has("EXPIRED"), true);
});

Deno.test("PayTransactionStatus - enum has exactly 4 values", () => {
  assertEquals(validStatuses.size, 4);
});

// --- Invalid status values ---

Deno.test("PayTransactionStatus - lowercase 'pending' is invalid", () => {
  assertEquals(validStatuses.has("pending"), false);
});

Deno.test("PayTransactionStatus - arbitrary string is invalid", () => {
  assertEquals(validStatuses.has("CANCELLED"), false);
  assertEquals(validStatuses.has("PROCESSING"), false);
  assertEquals(validStatuses.has("foobar"), false);
});

Deno.test("PayTransactionStatus - empty string is invalid", () => {
  assertEquals(validStatuses.has(""), false);
});

// --- null/undefined handling in the handler's condition ---

Deno.test("PayTransactionStatus - null statusParam skips validation (handler allows all)", () => {
  // The handler's condition: if (statusParam && !validStatuses.has(statusParam))
  // When statusParam is null, the condition is falsy so validation is skipped
  const statusParam: string | null = null;
  const wouldReject = statusParam !== null && statusParam !== "" && !validStatuses.has(statusParam);
  assertEquals(wouldReject, false, "null should not trigger validation rejection");
});

Deno.test("PayTransactionStatus - undefined statusParam skips validation", () => {
  const statusParam: string | undefined = undefined;
  // Mimicking: params.get("status") returns null when absent, but testing undefined too
  const wouldReject = !!statusParam && !validStatuses.has(statusParam);
  assertEquals(wouldReject, false, "undefined should not trigger validation rejection");
});

Deno.test("PayTransactionStatus - valid statusParam passes validation", () => {
  const statusParam = "PENDING";
  const wouldReject = !!statusParam && !validStatuses.has(statusParam);
  assertEquals(wouldReject, false, "Valid status should not be rejected");
});

Deno.test("PayTransactionStatus - invalid statusParam is rejected", () => {
  const statusParam = "INVALID";
  const wouldReject = !!statusParam && !validStatuses.has(statusParam);
  assertEquals(wouldReject, true, "Invalid status should be rejected");
});
