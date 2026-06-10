import { assert, assertEquals } from "@std/assert";
import { newNoop } from "@/utils/logger/index.ts";
import {
  MAX_NOTIFY_PAYLOAD_BYTES,
  PgNotifyEventBus,
} from "@/core/service/events/pg-notify-event-bus.ts";
import type { ProviderEvent } from "@/core/service/events/event.types.ts";

const PP_PUBLIC_KEY =
  "GPP1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const PP_LABEL = "Test Provider";
const CHANNEL_AUTH_ID = "CCHANNEL000000000000000000000000000000000000000000000";

function mkEvent(bundleId: string): ProviderEvent {
  return {
    kind: "mempool.bundle_added",
    ts: 1,
    scope: { ppPublicKey: PP_PUBLIC_KEY, ppLabel: PP_LABEL },
    payload: {
      bundleId,
      weight: 1,
      channelContractId: CHANNEL_AUTH_ID,
      newSlot: false,
      entityName: null,
      jurisdictions: [],
      amount: null,
    },
  };
}

function mkRecordingNotifier() {
  const captured: string[] = [];
  return {
    captured,
    notify: (payload: string) => {
      captured.push(payload);
      return Promise.resolve();
    },
  };
}

Deno.test("subscribe + publishLocal: local listener receives event", () => {
  const bus = new PgNotifyEventBus({ log: newNoop() });
  const received: ProviderEvent[] = [];
  const unsub = bus.subscribe((e) => received.push(e));

  bus.publishLocal(mkEvent("b1"));

  assertEquals(received.length, 1);
  assertEquals(received[0].kind, "mempool.bundle_added");
  unsub();
});

Deno.test("subscribe returns working unsubscribe", () => {
  const bus = new PgNotifyEventBus({ log: newNoop() });
  const received: ProviderEvent[] = [];
  const unsub = bus.subscribe((e) => received.push(e));
  unsub();
  bus.publishLocal(mkEvent("b1"));
  assertEquals(received.length, 0);
});

Deno.test("listener errors do not break the publish loop", () => {
  const bus = new PgNotifyEventBus({ log: newNoop() });
  const got: string[] = [];
  bus.subscribe(() => {
    throw new Error("listener exploded");
  });
  bus.subscribe((e) => {
    if (e.kind === "mempool.bundle_added") got.push(e.payload.bundleId);
  });
  bus.publishLocal(mkEvent("b1"));
  bus.publishLocal(mkEvent("b2"));
  assertEquals(got, ["b1", "b2"]);
});

Deno.test("emit before setNotifier falls back to local loopback", () => {
  const bus = new PgNotifyEventBus({ log: newNoop() });
  const received: ProviderEvent[] = [];
  bus.subscribe((e) => received.push(e));

  bus.emit(mkEvent("b1"));

  assertEquals(received.length, 1);
  if (received[0].kind === "mempool.bundle_added") {
    assertEquals(received[0].payload.bundleId, "b1");
  }
});

Deno.test("emit after setNotifier fires NOTIFY only — does NOT publish locally", () => {
  const bus = new PgNotifyEventBus({ log: newNoop() });
  const { captured, notify } = mkRecordingNotifier();
  bus.setNotifier(notify);

  const received: ProviderEvent[] = [];
  bus.subscribe((e) => received.push(e));

  bus.emit(mkEvent("b1"));

  // Single-path delivery: emit must NOT short-circuit to local subscribers.
  // Delivery only happens when pgListener calls publishLocal() on the
  // round-tripped NOTIFY.
  assertEquals(received.length, 0);
  assertEquals(captured.length, 1);
  const parsed = JSON.parse(captured[0]) as ProviderEvent;
  assertEquals(parsed.kind, "mempool.bundle_added");
});

Deno.test("emit drops oversize events instead of throwing", () => {
  const bus = new PgNotifyEventBus({ log: newNoop() });
  const { captured, notify } = mkRecordingNotifier();
  bus.setNotifier(notify);

  // Synthetic verifier event with enough bundle IDs to exceed the cap.
  const bigBundleIds = Array.from({ length: 1000 }, (_, i) => `bundle-${i}`);
  const oversize: ProviderEvent = {
    kind: "verifier.bundle_completed",
    ts: 1,
    scope: { ppPublicKey: PP_PUBLIC_KEY, ppLabel: PP_LABEL },
    payload: {
      txId: "tx-1",
      bundleIds: bigBundleIds,
      channelContractId: CHANNEL_AUTH_ID,
    },
  };
  assert(JSON.stringify(oversize).length >= MAX_NOTIFY_PAYLOAD_BYTES);

  bus.emit(oversize);
  assertEquals(captured.length, 0);
});

Deno.test("publishLocal preserves emit order", () => {
  const bus = new PgNotifyEventBus({ log: newNoop() });
  const received: string[] = [];
  bus.subscribe((e) => {
    if (e.kind === "mempool.bundle_added") received.push(e.payload.bundleId);
  });
  for (let i = 0; i < 5; i++) bus.publishLocal(mkEvent(`b${i}`));
  assertEquals(received, ["b0", "b1", "b2", "b3", "b4"]);
});

Deno.test("simulated cross-machine: emit→NOTIFY payload→publishLocal delivers to subscriber", () => {
  // Models the production path end-to-end without a real Postgres: the bus
  // serializes the event into a NOTIFY payload, a stand-in listener loop
  // deserializes it and calls publishLocal — which is exactly how
  // pg-listener.ts:onNotify drives the bus on every machine in production.
  const bus = new PgNotifyEventBus({ log: newNoop() });
  const { captured, notify } = mkRecordingNotifier();
  bus.setNotifier(notify);

  const received: ProviderEvent[] = [];
  bus.subscribe((e) => received.push(e));

  bus.emit(mkEvent("b1"));

  assertEquals(captured.length, 1);
  bus.publishLocal(JSON.parse(captured[0]) as ProviderEvent);

  assertEquals(received.length, 1);
  if (received[0].kind === "mempool.bundle_added") {
    assertEquals(received[0].payload.bundleId, "b1");
  }
});

Deno.test("NOTIFY rejection is swallowed — does not throw into caller", async () => {
  const bus = new PgNotifyEventBus({ log: newNoop() });
  bus.setNotifier(() => Promise.reject(new Error("transport broken")));

  // emit() must not throw synchronously or asynchronously.
  bus.emit(mkEvent("b1"));
  // Yield to flush the rejection through the catch — bus catches it; we just
  // confirm the test process doesn't blow up.
  await new Promise((r) => setTimeout(r, 0));
});
