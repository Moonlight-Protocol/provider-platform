import { assertEquals } from "@std/assert";
import { isWithdrawOnlyBundle } from "./bundle.service.ts";
import type { ClassifiedOperations } from "./bundle.types.ts";

// isWithdrawOnlyBundle only inspects per-kind counts, so lightweight stand-ins
// for the operation objects are sufficient here.
function classified(
  counts: {
    create?: number;
    spend?: number;
    deposit?: number;
    withdraw?: number;
  },
): ClassifiedOperations {
  const fill = (n = 0) =>
    Array.from({ length: n }, () => ({})) as unknown as never[];
  return {
    create: fill(counts.create),
    spend: fill(counts.spend),
    deposit: fill(counts.deposit),
    withdraw: fill(counts.withdraw),
  } as unknown as ClassifiedOperations;
}

Deno.test("isWithdrawOnlyBundle - withdraw with change is allowed", () => {
  // spend a UTXO, create change, withdraw the rest → withdraw-only.
  assertEquals(
    isWithdrawOnlyBundle(classified({ spend: 1, create: 1, withdraw: 1 })),
    true,
  );
});

Deno.test("isWithdrawOnlyBundle - pure withdraw is allowed", () => {
  assertEquals(
    isWithdrawOnlyBundle(classified({ spend: 1, withdraw: 1 })),
    true,
  );
});

Deno.test("isWithdrawOnlyBundle - deposit is rejected", () => {
  assertEquals(
    isWithdrawOnlyBundle(classified({ deposit: 1, create: 1 })),
    false,
  );
});

Deno.test("isWithdrawOnlyBundle - deposit alongside a withdraw is rejected", () => {
  assertEquals(
    isWithdrawOnlyBundle(classified({ deposit: 1, withdraw: 1 })),
    false,
  );
});

Deno.test("isWithdrawOnlyBundle - send/transfer (no withdraw) is rejected", () => {
  // spend + create for another party, no withdraw → a send, not withdraw-only.
  assertEquals(
    isWithdrawOnlyBundle(classified({ spend: 1, create: 1 })),
    false,
  );
});

Deno.test("isWithdrawOnlyBundle - empty bundle is not withdraw-only", () => {
  assertEquals(isWithdrawOnlyBundle(classified({})), false);
});
