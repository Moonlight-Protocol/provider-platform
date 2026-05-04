import { assert, assertEquals } from "@std/assert";
import { extractNetworkErrorContext } from "@/core/service/executor/error-extraction.ts";

Deno.test("extractNetworkErrorContext — returns undefined for non-Colibri Error", () => {
  assertEquals(extractNetworkErrorContext(new Error("plain")), undefined);
  assertEquals(extractNetworkErrorContext(undefined), undefined);
  assertEquals(extractNetworkErrorContext("string error"), undefined);
});

Deno.test("extractNetworkErrorContext — extracts STX_007 envelope", () => {
  // Mirrors @colibri/core ERROR_STATUS shape: code/domain/source on the error,
  // meta.data.{errorResult, diagnosticEvents, input.transaction.{hash(),sequence}}.
  const fakeColibri = Object.assign(
    new Error("Transaction processing error!"),
    {
      code: "STX_007",
      domain: "processes",
      source: "@colibri/core/processes/send-transaction",
      meta: {
        data: {
          errorResult: ["txInsufficientFee"],
          diagnosticEvents: [{ event: "diag1" }],
          input: {
            transaction: {
              hash: () => ({ toString: (_e?: string) => "deadbeef" }),
              sequence: "9720769416265729",
            },
          },
        },
      },
    },
  );

  const ctx = extractNetworkErrorContext(fakeColibri);
  assert(ctx);
  assertEquals(ctx.code, "STX_007");
  assertEquals(ctx.domain, "processes");
  assertEquals(ctx.source, "@colibri/core/processes/send-transaction");
  assertEquals(ctx.txHash, "deadbeef");
  assertEquals(ctx.txSeqNum, "9720769416265729");
  assertEquals(ctx.errorResult, ["txInsufficientFee"]);
  assertEquals(ctx.diagnosticEvents, [{ event: "diag1" }]);
});

Deno.test("extractNetworkErrorContext — handles ConveeError-wrapped Colibri (Object.assign)", () => {
  // ConveeError uses Object.assign(this, originalError) so code/meta land on
  // the wrapper. Duck-typing should still find them.
  const original = Object.assign(new Error("orig"), {
    code: "STX_007",
    domain: "processes",
    source: "x",
    meta: { data: { errorResult: ["txBadAuth"], diagnosticEvents: [] } },
  });
  const wrapper = Object.assign(new Error("wrapped"), original);

  const ctx = extractNetworkErrorContext(wrapper);
  assert(ctx);
  assertEquals(ctx.code, "STX_007");
  assertEquals(ctx.errorResult, ["txBadAuth"]);
});

Deno.test("extractNetworkErrorContext — tolerates missing optional fields", () => {
  const partial = Object.assign(new Error("partial"), {
    code: "STX_010",
    meta: { data: { errorResult: null, diagnosticEvents: [] } },
  });

  const ctx = extractNetworkErrorContext(partial);
  assert(ctx);
  assertEquals(ctx.code, "STX_010");
  assertEquals(ctx.txHash, undefined);
  assertEquals(ctx.domain, undefined);
});

Deno.test("extractNetworkErrorContext — silently drops broken hash() implementation", () => {
  const err = Object.assign(new Error(""), {
    code: "STX_007",
    meta: {
      data: {
        errorResult: [],
        input: {
          transaction: {
            hash: () => {
              throw new Error("hash failed");
            },
          },
        },
      },
    },
  });
  const ctx = extractNetworkErrorContext(err);
  assert(ctx);
  assertEquals(ctx.txHash, undefined);
  assertEquals(ctx.code, "STX_007");
});
