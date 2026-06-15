import { assertEquals } from "@std/assert";
import { newNoop } from "@/utils/logger/index.ts";
import { ChannelRegistry } from "./channel-registry.ts";
import {
  fetchCouncilConfig,
  reconcileChannelStatuses,
} from "./channel-convergence.ts";

const XLM_CHANNEL = "CXLMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4";
const USDC_CHANNEL = "CUSDCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHK3M";

// --- reconcileChannelStatuses: converge registry from a council config ---

Deno.test("reconcile - disabled channel in config → registry disabled", async () => {
  const registry = new ChannelRegistry([], { log: newNoop() });
  await reconcileChannelStatuses(registry, {
    channels: [
      { channelContractId: XLM_CHANNEL, status: "enabled" },
      { channelContractId: USDC_CHANNEL, status: "disabled" },
    ],
  });

  assertEquals(registry.isDisabled(USDC_CHANNEL), true);
  assertEquals(registry.isDisabled(XLM_CHANNEL), false);
  assertEquals(registry.get(XLM_CHANNEL)?.state, "active");
  assertEquals(registry.get(USDC_CHANNEL)?.state, "disabled");
});

Deno.test("reconcile - flips a previously-disabled channel back on re-enable", async () => {
  const registry = new ChannelRegistry([], { log: newNoop() });
  await reconcileChannelStatuses(registry, {
    channels: [{ channelContractId: USDC_CHANNEL, status: "disabled" }],
  });
  assertEquals(registry.isDisabled(USDC_CHANNEL), true);

  // Council re-enabled it; a later reconcile must converge back to active.
  await reconcileChannelStatuses(registry, {
    channels: [{ channelContractId: USDC_CHANNEL, status: "enabled" }],
  });
  assertEquals(registry.isDisabled(USDC_CHANNEL), false);
  assertEquals(registry.get(USDC_CHANNEL)?.state, "active");
});

Deno.test("reconcile - missing status defaults to enabled (back-compat)", async () => {
  const registry = new ChannelRegistry([], { log: newNoop() });
  await reconcileChannelStatuses(registry, {
    channels: [{ channelContractId: XLM_CHANNEL }],
  });
  assertEquals(registry.isDisabled(XLM_CHANNEL), false);
});

Deno.test("reconcile - tolerates empty / malformed config", async () => {
  const registry = new ChannelRegistry([], { log: newNoop() });
  await reconcileChannelStatuses(registry, {});
  await reconcileChannelStatuses(registry, { channels: [] });
  await reconcileChannelStatuses(registry, {
    channels: [{ status: "disabled" }], // no channelContractId → skipped
  });
  assertEquals(registry.getAll().length, 0);
});

// --- fetchCouncilConfig: the query, with a stubbed fetch ---

function withStubbedFetch(
  impl: (input: string | URL | Request) => Promise<Response>,
  run: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch =
    ((input: string | URL | Request) => impl(input)) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

Deno.test("fetchCouncilConfig - returns parsed council data", async () => {
  await withStubbedFetch(
    (input) => {
      assertEquals(
        String(input).includes("/api/v1/public/council?councilId=CAUTH"),
        true,
      );
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              channels: [{
                channelContractId: USDC_CHANNEL,
                status: "disabled",
              }],
            },
          }),
          { status: 200 },
        ),
      );
    },
    async () => {
      const data = await fetchCouncilConfig("http://council:8080", "CAUTH");
      assertEquals(data?.channels?.[0]?.channelContractId, USDC_CHANNEL);
      assertEquals(data?.channels?.[0]?.status, "disabled");
    },
  );
});

Deno.test("fetchCouncilConfig - returns null on non-OK response", async () => {
  await withStubbedFetch(
    () => Promise.resolve(new Response("nope", { status: 500 })),
    async () => {
      assertEquals(await fetchCouncilConfig("http://c", "CAUTH"), null);
    },
  );
});

Deno.test("fetchCouncilConfig - returns null when fetch throws", async () => {
  await withStubbedFetch(
    () => Promise.reject(new Error("network down")),
    async () => {
      assertEquals(await fetchCouncilConfig("http://c", "CAUTH"), null);
    },
  );
});

// --- End-to-end: query the council and reconcile the registry ---

Deno.test("query-council-and-reconcile - registry converges from the council query", async () => {
  const registry = new ChannelRegistry([], { log: newNoop() });
  await withStubbedFetch(
    () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              channels: [
                { channelContractId: XLM_CHANNEL, status: "enabled" },
                { channelContractId: USDC_CHANNEL, status: "disabled" },
              ],
            },
          }),
          { status: 200 },
        ),
      ),
    async () => {
      const data = await fetchCouncilConfig("http://council:8080", "CAUTH");
      assertEquals(data !== null, true);
      await reconcileChannelStatuses(registry, data!);
    },
  );

  // The provider learned USDC is disabled purely from the council query — the
  // boot / out-of-retention convergence path.
  assertEquals(registry.isDisabled(USDC_CHANNEL), true);
  assertEquals(registry.isDisabled(XLM_CHANNEL), false);
});
