import { assert, assertEquals } from "@std/assert";
import { newNoop } from "@/utils/logger/index.ts";
import type { ProviderEvent } from "@/core/service/events/event.types.ts";
import type { PpRepository } from "@/persistence/drizzle/repository/pp.repository.ts";

/**
 * Deterministic unit tests for `handleEventsWs`.
 *
 * The handler is exercised with a fully MOCKED WebSocket (and a mocked PP
 * repository + the in-process event-bus loopback) — no real server, no random
 * port, no wall-clock timing. The previous version of this file booted a real
 * `Deno.serve` and waited ~6 s to observe Deno's protocol-level auto-ping
 * keep-alive; that tested Deno's behaviour (not ours) and was timing-flaky.
 *
 * What we actually own and assert here:
 *   - upgrade gating: non-upgradable / missing token / invalid token / missing
 *     pp / unowned pp all short-circuit with the right status and never upgrade
 *   - the upgrade is configured with our subprotocol + idle-timeout (the
 *     keep-alive knob the heartbeat patch depends on)
 *   - scoped delivery: only events whose scope matches the bound PP are sent
 *   - the not-OPEN drop guard
 *   - unsubscribe on close (no delivery after the socket closes)
 *
 * Real end-to-end WS delivery over a live socket is covered by
 * tests/integration/http/events-ws.test.ts.
 */

// Env must exist before ws-handler.ts (it loads config/env.ts + service-auth-secret).
// Values are dummies — the DB is never queried because the PP repo is mocked.
for (
  const [k, val] of Object.entries({
    PORT: "8000",
    MODE: "development",
    LOG_LEVEL: "ERROR",
    DATABASE_URL: "postgres://test:test@localhost:5432/test",
    SERVICE_DOMAIN: "test.local",
    SERVICE_AUTH_SECRET: "dGVzdHRlc3R0ZXN0dGVzdHRlc3R0ZXN0dGVzdHRlc3Q=",
    CHALLENGE_TTL: "900",
    SESSION_TTL: "21600",
    NETWORK: "testnet",
    NETWORK_FEE: "1000000",
    MEMPOOL_SLOT_CAPACITY: "10",
    MEMPOOL_EXPENSIVE_OP_WEIGHT: "10",
    MEMPOOL_CHEAP_OP_WEIGHT: "1",
    MEMPOOL_EXECUTOR_INTERVAL_MS: "1000",
    MEMPOOL_VERIFIER_INTERVAL_MS: "1000",
    MEMPOOL_TTL_CHECK_INTERVAL_MS: "5000",
    MEMPOOL_MAX_RETRY_ATTEMPTS: "3",
    BUNDLE_MAX_OPERATIONS: "20",
  })
) {
  if (Deno.env.get(k) === undefined) Deno.env.set(k, val);
}

const { handleEventsWs, setPpRepoForTests, EVENTS_WS_SUBPROTOCOL } =
  await import("./ws-handler.ts");
const generateJwt = (await import("@/core/service/auth/generate-jwt.ts"))
  .default;
const { getEventBus } = await import(
  "@/core/service/events/pg-notify-event-bus.ts"
);

const OWNER = "GOWNER1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const OTHER_OWNER = "GOWNER2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const PP = "GPP1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const PP_LABEL = "Test Provider";

// Mock PP repo: the bound PP is owned only by OWNER.
setPpRepoForTests({
  findByPublicKeyAndOwner(pub: string, owner: string) {
    return Promise.resolve(
      pub === PP && owner === OWNER
        ? { publicKey: PP, label: PP_LABEL }
        : undefined,
    );
  },
} as unknown as PpRepository);

class MockSocket {
  readyState: number = WebSocket.OPEN;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  send(data: string) {
    this.sent.push(data);
  }
  triggerOpen() {
    this.onopen?.();
  }
  triggerClose() {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.();
  }
}

interface MockCtx {
  ctx: unknown;
  res: { status: number; body: unknown };
  upgradeArgs: { protocol?: string; idleTimeout?: number } | null;
}

function mockCtx(opts: {
  upgradable?: boolean;
  proto?: string | null;
  ppPublicKey?: string | undefined;
  socket?: MockSocket;
}): MockCtx {
  const res = { status: 0, body: undefined as unknown };
  const state: MockCtx = { ctx: null, res, upgradeArgs: null };
  const headers = new Headers();
  if (opts.proto != null) headers.set("Sec-WebSocket-Protocol", opts.proto);
  state.ctx = {
    isUpgradable: opts.upgradable ?? true,
    request: { headers },
    response: res,
    params: { ppPublicKey: opts.ppPublicKey },
    upgrade(args: { protocol?: string; idleTimeout?: number }) {
      state.upgradeArgs = args;
      return opts.socket;
    },
  };
  return state;
}

function mkEvent(ppPublicKey: string, bundleId: string): ProviderEvent {
  return {
    kind: "mempool.bundle_added",
    ts: Date.now(),
    scope: { ppPublicKey, ppLabel: PP_LABEL },
    payload: {
      bundleId,
      weight: 1,
      channelContractId: "CCHANNEL00000000000000000000000000000000000000000000",
      newSlot: false,
    },
  } as ProviderEvent;
}

const deps = { log: newNoop() };

// --- gating: never upgrades on a bad request ---

Deno.test("rejects non-upgradable request with 426", async () => {
  const m = mockCtx({ upgradable: false });
  await handleEventsWs(deps)(m.ctx as never);
  assertEquals(m.res.status, 426);
  assertEquals(m.upgradeArgs, null);
});

Deno.test("rejects missing bearer token with 401", async () => {
  const m = mockCtx({ proto: EVENTS_WS_SUBPROTOCOL });
  await handleEventsWs(deps)(m.ctx as never);
  assertEquals(m.res.status, 401);
  assertEquals(m.upgradeArgs, null);
});

Deno.test("rejects invalid token with 401", async () => {
  const m = mockCtx({ proto: `${EVENTS_WS_SUBPROTOCOL}, bearer.not-a-jwt` });
  await handleEventsWs(deps)(m.ctx as never);
  assertEquals(m.res.status, 401);
  assertEquals(m.upgradeArgs, null);
});

Deno.test("rejects missing :ppPublicKey with 400", async () => {
  const jwt = await generateJwt(OWNER, "challenge");
  const m = mockCtx({
    proto: `${EVENTS_WS_SUBPROTOCOL}, bearer.${jwt}`,
    ppPublicKey: undefined,
  });
  await handleEventsWs(deps)(m.ctx as never);
  assertEquals(m.res.status, 400);
  assertEquals(m.upgradeArgs, null);
});

Deno.test("rejects PP not owned by operator with 403", async () => {
  const jwt = await generateJwt(OTHER_OWNER, "challenge");
  const m = mockCtx({
    proto: `${EVENTS_WS_SUBPROTOCOL}, bearer.${jwt}`,
    ppPublicKey: PP,
  });
  await handleEventsWs(deps)(m.ctx as never);
  assertEquals(m.res.status, 403);
  assertEquals(m.upgradeArgs, null);
});

// --- happy path: upgrade config + scoped delivery + lifecycle ---

Deno.test("upgrades with subprotocol + idle-timeout, delivers only scoped events, unsubscribes on close", async () => {
  const socket = new MockSocket();
  const jwt = await generateJwt(OWNER, "challenge");
  const m = mockCtx({
    proto: `${EVENTS_WS_SUBPROTOCOL}, bearer.${jwt}`,
    ppPublicKey: PP,
    socket,
  });

  await handleEventsWs(deps)(m.ctx as never);

  // upgraded with our subprotocol + the keep-alive idle timeout
  assert(m.upgradeArgs !== null, "expected ctx.upgrade to be called");
  assertEquals(m.upgradeArgs!.protocol, EVENTS_WS_SUBPROTOCOL);
  assert(
    typeof m.upgradeArgs!.idleTimeout === "number" &&
      m.upgradeArgs!.idleTimeout > 0,
    "expected a positive idleTimeout",
  );

  // subscription happens on open
  socket.triggerOpen();
  const bus = getEventBus(deps);

  // matching-PP event is delivered
  bus.emit(mkEvent(PP, "b1"));
  assertEquals(socket.sent.length, 1);
  assertEquals(
    (JSON.parse(socket.sent[0]) as ProviderEvent).scope.ppPublicKey,
    PP,
  );

  // event for a different PP is filtered out
  bus.emit(mkEvent(OTHER_OWNER, "b2"));
  assertEquals(socket.sent.length, 1);

  // drop guard: not delivered when the socket isn't OPEN
  socket.readyState = WebSocket.CLOSING;
  bus.emit(mkEvent(PP, "b3"));
  assertEquals(socket.sent.length, 1);

  // unsubscribe on close: nothing delivered afterwards
  socket.triggerClose();
  bus.emit(mkEvent(PP, "b4"));
  assertEquals(socket.sent.length, 1);
});
