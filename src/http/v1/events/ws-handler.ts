import type { Context } from "@oak/oak";
import { verify } from "@zaubrik/djwt";
import { LOG } from "@/config/logger.ts";
import { SERVICE_AUTH_SECRET_AS_CRYPTO_KEY } from "@/core/service/auth/service/service-auth-secret.ts";
import type { JwtPayload } from "@/core/service/auth/generate-jwt.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PpRepository } from "@/persistence/drizzle/repository/pp.repository.ts";
import { eventBus } from "@/core/service/events/event-bus.ts";
import type { ProviderEvent } from "@/core/service/events/event.types.ts";

/**
 * WebSocket subprotocol the server echoes back on a successful upgrade.
 * Clients must offer this AND a "bearer.<JWT>" entry. Echoing this
 * non-secret name (rather than the bearer.* one) avoids leaking the
 * JWT into response logs.
 */
export const EVENTS_WS_SUBPROTOCOL = "moonlight.events.v1";

/** Bearer-style subprotocol entries are prefixed with this. */
const BEARER_PROTO_PREFIX = "bearer.";

/** Idle ping cadence. Deno sends a ping after this many seconds of silence. */
const IDLE_TIMEOUT_SECONDS = 30;

let ppRepository = new PpRepository(drizzleClient);

/** Test-only seam: inject a PP repository backed by the test DB. */
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

export async function eventsWsHandler(ctx: Context): Promise<void> {
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

  const ppPublicKey = ctx.request.url.searchParams.get("pp");
  if (!ppPublicKey) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing ?pp=<ppPublicKey> query param" };
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
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(event));
    } catch (error) {
      LOG.error("Failed to send event over WS", {
        kind: event.kind,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  socket.onopen = () => {
    unsubscribe = eventBus.subscribe(listener);
    LOG.info("Events WS opened", {
      ownerPublicKey: session.sub,
      ppPublicKey: boundPpPublicKey,
      ppLabel: boundPpLabel,
    });
  };
  socket.onclose = () => {
    cleanup();
    LOG.info("Events WS closed", { ppPublicKey: boundPpPublicKey });
  };
  socket.onerror = (event) => {
    LOG.warn("Events WS error", {
      ppPublicKey: boundPpPublicKey,
      message: event instanceof ErrorEvent ? event.message : "unknown",
    });
    cleanup();
  };
}
