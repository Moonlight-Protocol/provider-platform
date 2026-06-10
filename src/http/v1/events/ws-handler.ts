import type { Context } from "@oak/oak";
import { verify } from "@zaubrik/djwt";
import type { Logger } from "@/utils/logger/index.ts";
import { SERVICE_AUTH_SECRET_AS_CRYPTO_KEY } from "@/core/service/auth/service/service-auth-secret.ts";
import type { JwtPayload } from "@/core/service/auth/generate-jwt.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PpRepository } from "@/persistence/drizzle/repository/pp.repository.ts";
import { getEventBus } from "@/core/service/events/pg-notify-event-bus.ts";
import type { ProviderEvent } from "@/core/service/events/event.types.ts";

export const EVENTS_WS_SUBPROTOCOL = "moonlight.events.v1";

const BEARER_PROTO_PREFIX = "bearer.";

/**
 * `idleTimeout` is the no-pong-received deadline for the underlying Deno
 * WebSocket upgrade. Deno's `upgradeWebSocket` sends WS protocol-level
 * `ping` frames automatically every `idleTimeout / 2` seconds and closes
 * the connection if the client doesn't reply with a `pong` within the
 * full `idleTimeout` window. Pings + pongs are protocol-level — browsers
 * and the standard WebSocket client respond transparently with no
 * application-layer message required.
 *
 * Previously 30 s. That was tight enough that the per-PP harness against
 * deployed testnet was losing frames on every inter-bundle pause: Stellar
 * ledger close + Verifier polling exceeds 30 s between `bundle.X_completed`
 * and the next cycle's `mempool.bundle_added`. The WS dropped, the
 * subscriber reconnected (no replay), the events that arrived in the
 * disconnect window were lost.
 *
 * 60 s gives Deno's auto-ping a 30 s tick, covers Stellar testnet's
 * worst-case inter-bundle latency, and stays at parity with industry
 * baselines: nginx default proxy_read_timeout 60 s, Fly proxy default
 * idle 60 s. We don't need to exceed the upstream proxy ceiling — the
 * proxy is reading the WS data frames + ping frames as activity, so the
 * connection stays alive on its side too.
 */
const IDLE_TIMEOUT_SECONDS = 60;

let ppRepository = new PpRepository(drizzleClient);

export function setPpRepoForTests(repo: PpRepository): void {
  ppRepository = repo;
}

function extractBearerToken(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const entries = headerValue.split(",").map((s) => s.trim());
  for (const entry of entries) {
    if (entry.startsWith(BEARER_PROTO_PREFIX)) {
      const token = entry.slice(BEARER_PROTO_PREFIX.length);
      if (token.length > 0) return token;
    }
  }
  return null;
}

async function verifyJwtToken(token: string): Promise<JwtPayload | null> {
  try {
    const payload = await verify(token, SERVICE_AUTH_SECRET_AS_CRYPTO_KEY);
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === "number" && now > payload.exp) return null;
    if (typeof payload.sub !== "string") return null;
    return payload as JwtPayload;
  } catch {
    return null;
  }
}

type RouteParams = { ppPublicKey?: string };

export function handleEventsWs(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("eventsWs");

  return async (ctx) => {
    log.info("eventsWs");
    if (!ctx.isUpgradable) {
      ctx.response.status = 426;
      ctx.response.body = { error: "WebSocket upgrade required" };
      return;
    }

    const protoHeader = ctx.request.headers.get("Sec-WebSocket-Protocol");
    const token = extractBearerToken(protoHeader);
    if (!token) {
      ctx.response.status = 401;
      ctx.response.body = {
        error: "Missing bearer.<jwt> Sec-WebSocket-Protocol entry",
      };
      return;
    }

    const session = await verifyJwtToken(token);
    if (!session) {
      ctx.response.status = 401;
      ctx.response.body = { error: "Invalid or expired token" };
      return;
    }

    const params = (ctx as unknown as { params?: RouteParams }).params;
    const ppPublicKey = params?.ppPublicKey;
    if (!ppPublicKey) {
      ctx.response.status = 400;
      ctx.response.body = {
        error: "Missing :ppPublicKey URL path param",
      };
      return;
    }

    const pp = await ppRepository.findByPublicKeyAndOwner(
      ppPublicKey,
      session.sub,
    );
    if (!pp) {
      ctx.response.status = 403;
      ctx.response.body = { error: "PP not owned by authenticated operator" };
      return;
    }

    const boundPpPublicKey = pp.publicKey;
    const boundPpLabel = pp.label;

    const socket = ctx.upgrade({
      protocol: EVENTS_WS_SUBPROTOCOL,
      idleTimeout: IDLE_TIMEOUT_SECONDS,
    });

    let unsubscribe: (() => void) | null = null;
    let closed = false;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
    };

    const listener = (event: ProviderEvent) => {
      if (event.scope.ppPublicKey !== boundPpPublicKey) return;
      if (socket.readyState !== WebSocket.OPEN) {
        log.debug("kind", event.kind);
        log.debug("readyState", socket.readyState);
        log.event("event dropped: WS not OPEN");
        return;
      }
      try {
        socket.send(JSON.stringify(event));
        log.debug("kind", event.kind);
        log.event("event sent to WS");
      } catch (error) {
        log.debug("kind", event.kind);
        log.error(error, "failed to send event over WS");
      }
    };

    socket.onopen = () => {
      unsubscribe = getEventBus(deps).subscribe(listener);
      log.debug("ownerPublicKey", session.sub);
      log.debug("ppPublicKey", boundPpPublicKey);
      log.debug("ppLabel", boundPpLabel);
      log.event("events WS opened");
    };
    socket.onclose = () => {
      cleanup();
      log.debug("ppPublicKey", boundPpPublicKey);
      log.event("events WS closed");
    };
    socket.onerror = (event) => {
      log.debug("ppPublicKey", boundPpPublicKey);
      log.error(event, "events WS error");
      cleanup();
    };
  };
}
