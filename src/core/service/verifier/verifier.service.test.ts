import { assertEquals } from "@std/assert";
import { verifyTransactionOnNetwork } from "./verifier.service.ts";
import type { Server } from "stellar-sdk/rpc";
import { newNoop } from "@/utils/logger/index.ts";

const log = newNoop();

function serverReturning(resp: unknown): Server {
  // deno-lint-ignore require-await -- mock satisfies getTransaction async contract
  return { getTransaction: async () => resp } as unknown as Server;
}

function serverThrowing(err: unknown): Server {
  return {
    getTransaction: () => Promise.reject(err),
  } as unknown as Server;
}

Deno.test("verifyTransactionOnNetwork - SUCCESS status verifies", async () => {
  const res = await verifyTransactionOnNetwork(
    "hash",
    serverReturning({ status: "SUCCESS", ledger: 42 }),
    { log },
  );
  assertEquals(res.status, "VERIFIED");
});

Deno.test("verifyTransactionOnNetwork - FAILED status is terminal FAILED", async () => {
  const res = await verifyTransactionOnNetwork(
    "hash",
    serverReturning({ status: "FAILED", resultXdr: "abc" }),
    { log },
  );
  assertEquals(res.status, "FAILED");
});

Deno.test("verifyTransactionOnNetwork - NOT_FOUND is pending", async () => {
  const res = await verifyTransactionOnNetwork(
    "hash",
    serverReturning({ status: "NOT_FOUND" }),
    { log },
  );
  assertEquals(res.status, "PENDING");
});

Deno.test("verifyTransactionOnNetwork - null response is pending", async () => {
  const res = await verifyTransactionOnNetwork(
    "hash",
    serverReturning(null),
    { log },
  );
  assertEquals(res.status, "PENDING");
});

Deno.test(
  "verifyTransactionOnNetwork - transient RPC error is pending, not failed",
  async () => {
    // A thrown RPC error (timeout / 5xx / connection reset) leaves the on-chain
    // outcome unknown; it must NOT be reported as a failure. Regression guard:
    // this previously returned FAILED and terminally false-failed applied txs.
    const res = await verifyTransactionOnNetwork(
      "hash",
      serverThrowing(new Error("503 Service Unavailable")),
      { log },
    );
    assertEquals(res.status, "PENDING");
  },
);

Deno.test(
  "verifyTransactionOnNetwork - 'not found' throw is pending",
  async () => {
    const res = await verifyTransactionOnNetwork(
      "hash",
      serverThrowing(new Error("transaction not found")),
      { log },
    );
    assertEquals(res.status, "PENDING");
  },
);
