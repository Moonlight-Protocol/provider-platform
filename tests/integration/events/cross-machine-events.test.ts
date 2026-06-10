import "../../ensure_test_env.ts";
import { assertEquals } from "@std/assert";
import { PGlite } from "@electric-sql/pglite";
import { newNoop } from "@/utils/logger/index.ts";
import {
  PgNotifyEventBus,
  PROVIDER_EVENTS_CHANNEL,
} from "@/core/service/events/pg-notify-event-bus.ts";
import type { ProviderEvent } from "@/core/service/events/event.types.ts";

/**
 * Simulates the cross-machine production flow: an event emitted on bus B
 * (machine B) reaches a subscriber on bus A (machine A) via Postgres
 * LISTEN/NOTIFY.
 *
 * Real production uses postgres-js against a real Postgres DB; here we use
 * PGlite (in-process Postgres in Wasm) and PGlite's native LISTEN API.
 * Same wire-format semantics — the bus's serialize → NOTIFY → LISTEN →
 * parse → publishLocal → subscriber path is exercised end-to-end. The
 * Phase 4 local-dev multi-machine smoke covers the two-OS-process variant.
 */

const PP_PUBLIC_KEY =
  "GPP1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const PP_LABEL = "Test Provider";
const CHANNEL_AUTH_ID = "CCHANNEL000000000000000000000000000000000000000000000";

function mkBundleAddedEvent(bundleId: string): ProviderEvent {
  return {
    kind: "mempool.bundle_added",
    ts: 1,
    scope: { ppPublicKey: PP_PUBLIC_KEY, ppLabel: PP_LABEL },
    payload: {
      bundleId,
      weight: 1,
      channelContractId: CHANNEL_AUTH_ID,
      newSlot: true,
      entityName: null,
      jurisdictions: [],
      amount: null,
    },
  };
}

function waitForEvents<T>(target: T[], min: number, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const start = performance.now();
    const tick = () => {
      if (target.length >= min) return resolve();
      if (performance.now() - start > timeoutMs) {
        return reject(
          new Error(
            `expected ≥${min} events within ${timeoutMs}ms, got ${target.length}`,
          ),
        );
      }
      setTimeout(tick, 5);
    };
    tick();
  });
}

Deno.test({
  name:
    "cross-machine event delivery: emit on B → LISTEN/NOTIFY → subscriber on A",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const pg = new PGlite();
    try {
      // --- Machine A: subscriber + LISTEN task -------------------------------
      const busA = new PgNotifyEventBus({ log: newNoop() });
      const received: ProviderEvent[] = [];
      busA.subscribe((e) => received.push(e));

      await pg.listen(PROVIDER_EVENTS_CHANNEL, (payload) => {
        try {
          busA.publishLocal(JSON.parse(payload) as ProviderEvent);
        } catch { /* swallow — matches pg-listener.ts:onNotify */ }
      });

      // --- Machine B: notifier wired to the same PG instance -----------------
      const busB = new PgNotifyEventBus({ log: newNoop() });
      busB.setNotifier(async (payload) => {
        await pg.query("SELECT pg_notify($1, $2)", [
          PROVIDER_EVENTS_CHANNEL,
          payload,
        ]);
      });

      // --- Drive the cross-machine path --------------------------------------
      busB.emit(mkBundleAddedEvent("b1"));
      busB.emit(mkBundleAddedEvent("b2"));
      busB.emit(mkBundleAddedEvent("b3"));

      await waitForEvents(received, 3, 2_000);

      assertEquals(received.length, 3);
      const ids = received
        .filter((e) => e.kind === "mempool.bundle_added")
        .map((
          e,
        ) => (e.kind === "mempool.bundle_added" ? e.payload.bundleId : ""));
      assertEquals(ids, ["b1", "b2", "b3"]);
    } finally {
      await pg.close();
    }
  },
});

Deno.test({
  name:
    "cross-machine: emit on A is also received locally on A via LISTEN round-trip",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    // Production invariant: even local emitters round-trip through Postgres.
    // The emitter's own subscribers receive via LISTEN, not via a local
    // short-circuit. Verifies the single-path-delivery rule end-to-end.
    const pg = new PGlite();
    try {
      const bus = new PgNotifyEventBus({ log: newNoop() });
      const received: ProviderEvent[] = [];
      bus.subscribe((e) => received.push(e));

      await pg.listen(PROVIDER_EVENTS_CHANNEL, (payload) => {
        try {
          bus.publishLocal(JSON.parse(payload) as ProviderEvent);
        } catch { /* */ }
      });

      bus.setNotifier(async (payload) => {
        await pg.query("SELECT pg_notify($1, $2)", [
          PROVIDER_EVENTS_CHANNEL,
          payload,
        ]);
      });

      bus.emit(mkBundleAddedEvent("self-1"));
      await waitForEvents(received, 1, 2_000);

      assertEquals(received.length, 1);
      if (received[0].kind === "mempool.bundle_added") {
        assertEquals(received[0].payload.bundleId, "self-1");
      }
    } finally {
      await pg.close();
    }
  },
});

Deno.test({
  name:
    "cross-machine: malformed NOTIFY payload is dropped, well-formed events still deliver",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const pg = new PGlite();
    try {
      const bus = new PgNotifyEventBus({ log: newNoop() });
      const received: ProviderEvent[] = [];
      bus.subscribe((e) => received.push(e));

      await pg.listen(PROVIDER_EVENTS_CHANNEL, (payload) => {
        try {
          const parsed = JSON.parse(payload);
          if (
            parsed && typeof parsed === "object" &&
            typeof parsed.kind === "string"
          ) {
            bus.publishLocal(parsed as ProviderEvent);
          }
        } catch { /* */ }
      });

      // Inject a garbage payload directly via NOTIFY.
      await pg.query("SELECT pg_notify($1, $2)", [
        PROVIDER_EVENTS_CHANNEL,
        "not-json-{{{",
      ]);
      // Inject a well-formed payload right after.
      await pg.query("SELECT pg_notify($1, $2)", [
        PROVIDER_EVENTS_CHANNEL,
        JSON.stringify(mkBundleAddedEvent("good")),
      ]);

      await waitForEvents(received, 1, 2_000);
      assertEquals(received.length, 1);
      if (received[0].kind === "mempool.bundle_added") {
        assertEquals(received[0].payload.bundleId, "good");
      }
    } finally {
      await pg.close();
    }
  },
});
