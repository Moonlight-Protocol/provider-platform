import "../../ensure_test_env.ts";
import { Application, Router } from "@oak/oak";
import { assert, assertEquals } from "@std/assert";
import { newNoop } from "@/utils/logger/index.ts";
import generateJwt from "@/core/service/auth/generate-jwt.ts";
import { EVENTS_WS_SUBPROTOCOL } from "@/http/v1/events/ws-handler.ts";
import { getEventBus } from "@/core/service/events/event-bus.ts";
import type { ProviderEvent } from "@/core/service/events/event.types.ts";
import { buildProvidersRouter } from "@/http/v1/providers/routes.ts";
import {
  councilMembership,
  CouncilMembershipStatus,
} from "@/persistence/drizzle/entity/council-membership.entity.ts";
import { paymentProvider } from "@/persistence/drizzle/entity/pp.entity.ts";
import { ensureInitialized, getTestDb } from "../../test_helpers.ts";

const OWNER_PUBLIC_KEY =
  "GOWNER1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const OTHER_OWNER_PUBLIC_KEY =
  "GOWNER2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const PP_PUBLIC_KEY =
  "GPP1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const PP_LABEL = "Test Provider";
const CHANNEL_AUTH_ID = "CCHANNEL000000000000000000000000000000000000000000000";

function createTestApp(): Application {
  const app = new Application();
  const apiRouter = new Router();
  const providersRouter = buildProvidersRouter({ log: newNoop() });
  apiRouter.use(
    "/api/v1",
    providersRouter.routes(),
    providersRouter.allowedMethods(),
  );
  app.use(apiRouter.routes());
  app.use(apiRouter.allowedMethods());
  return app;
}

async function startServer(): Promise<
  { port: number; controller: AbortController; serverPromise: Promise<void> }
> {
  const app = createTestApp();
  const controller = new AbortController();
  const port = await new Promise<number>((resolve) => {
    app.addEventListener("listen", (evt) => resolve(evt.port));
    void app.listen({ port: 0, signal: controller.signal });
  });
  const serverPromise = new Promise<void>((resolve) => {
    app.addEventListener("close", () => resolve());
  });
  return { port, controller, serverPromise };
}

async function seedOperatorAndPp(): Promise<void> {
  const db = getTestDb();
  await db.delete(councilMembership);
  await db.delete(paymentProvider);
  const now = new Date();
  await db.insert(paymentProvider).values({
    id: "pp-test-1",
    publicKey: PP_PUBLIC_KEY,
    encryptedSk: "encrypted-test-sk",
    derivationIndex: 0,
    ownerPublicKey: OWNER_PUBLIC_KEY,
    isActive: true,
    label: PP_LABEL,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(councilMembership).values({
    id: "membership-test-1",
    councilUrl: "https://council.example.test",
    councilName: "Test Council",
    councilPublicKey: "GCOUNCIL1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    channelAuthId: CHANNEL_AUTH_ID,
    status: CouncilMembershipStatus.ACTIVE,
    ppPublicKey: PP_PUBLIC_KEY,
    createdAt: now,
    updatedAt: now,
  });
}

async function mintJwt(ownerPublicKey: string): Promise<string> {
  return await generateJwt(ownerPublicKey, "test-challenge-hash");
}

function wsUrl(port: number, ppPublicKey: string): string {
  return `ws://127.0.0.1:${port}/api/v1/providers/${
    encodeURIComponent(ppPublicKey)
  }/events/ws`;
}

function openWs(port: number, jwt: string, ppPublicKey: string): WebSocket {
  return new WebSocket(
    wsUrl(port, ppPublicKey),
    [EVENTS_WS_SUBPROTOCOL, `bearer.${jwt}`],
  );
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.readyState === WebSocket.OPEN) return resolve();
    const onOpen = () => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      resolve();
    };
    const onError = () => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      reject(new Error("WebSocket failed to open"));
    };
    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
  });
}

function waitForMessage(
  socket: WebSocket,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error(`No WS message within ${timeoutMs}ms`));
    }, timeoutMs);
    const onMessage = (evt: MessageEvent) => {
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      resolve(typeof evt.data === "string" ? evt.data : String(evt.data));
    };
    socket.addEventListener("message", onMessage);
  });
}

async function closeWs(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return;
  await new Promise<void>((resolve) => {
    const onClose = () => {
      socket.removeEventListener("close", onClose);
      resolve();
    };
    socket.addEventListener("close", onClose);
    socket.close();
  });
}

Deno.test({
  name: "events-ws suite setup",
  async fn() {
    await ensureInitialized();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "delivers mempool event over WS within 1s of emission",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await ensureInitialized();
    await seedOperatorAndPp();

    const { port, controller, serverPromise } = await startServer();
    const jwt = await mintJwt(OWNER_PUBLIC_KEY);
    const socket = openWs(port, jwt, PP_PUBLIC_KEY);

    try {
      await waitForOpen(socket);

      const messagePromise = waitForMessage(socket, 1_000);

      const t0 = performance.now();
      // Emit directly to the event bus. scope-resolver isn't exercised here —
      // the WS plumbing is. (Cross-PP filtering is covered by a unit test on
      // scope-resolver.ts.)
      getEventBus({ log: newNoop() }).emit({
        kind: "mempool.bundle_added",
        ts: Date.now(),
        scope: { ppPublicKey: PP_PUBLIC_KEY, ppLabel: PP_LABEL },
        payload: {
          bundleId: "test-bundle-1",
          weight: 5,
          channelContractId: CHANNEL_AUTH_ID,
          newSlot: true,
        },
      });

      const raw = await messagePromise;
      const elapsed = performance.now() - t0;
      const parsed = JSON.parse(raw) as ProviderEvent;

      assert(
        elapsed < 1_000,
        `expected delivery within 1000ms, got ${elapsed.toFixed(1)}ms`,
      );
      assertEquals(parsed.kind, "mempool.bundle_added");
      assertEquals(parsed.scope.ppPublicKey, PP_PUBLIC_KEY);
      assertEquals(parsed.scope.ppLabel, PP_LABEL);
      if (parsed.kind === "mempool.bundle_added") {
        assertEquals(parsed.payload.bundleId, "test-bundle-1");
        assertEquals(parsed.payload.channelContractId, CHANNEL_AUTH_ID);
        assertEquals(parsed.payload.newSlot, true);
      }
    } finally {
      await closeWs(socket);
      controller.abort();
      await serverPromise.catch(() => {});
    }
  },
});

Deno.test({
  name: "rejects WS without bearer.<jwt> subprotocol",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await ensureInitialized();
    await seedOperatorAndPp();

    const { port, controller, serverPromise } = await startServer();
    try {
      const res = await fetch(
        wsUrl(port, PP_PUBLIC_KEY).replace("ws://", "http://"),
        {
          headers: {
            "Upgrade": "websocket",
            "Connection": "Upgrade",
            "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
            "Sec-WebSocket-Version": "13",
          },
        },
      );
      await res.body?.cancel();
      assertEquals(res.status, 401);
    } finally {
      controller.abort();
      await serverPromise.catch(() => {});
    }
  },
});

Deno.test({
  name: "rejects WS when authenticated operator does not own the requested PP",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await ensureInitialized();
    await seedOperatorAndPp();

    const { port, controller, serverPromise } = await startServer();
    const jwt = await mintJwt(OTHER_OWNER_PUBLIC_KEY);
    try {
      const res = await fetch(
        wsUrl(port, PP_PUBLIC_KEY).replace("ws://", "http://"),
        {
          headers: {
            "Upgrade": "websocket",
            "Connection": "Upgrade",
            "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
            "Sec-WebSocket-Version": "13",
            "Sec-WebSocket-Protocol": `${EVENTS_WS_SUBPROTOCOL}, bearer.${jwt}`,
          },
        },
      );
      await res.body?.cancel();
      assertEquals(res.status, 403);
    } finally {
      controller.abort();
      await serverPromise.catch(() => {});
    }
  },
});
