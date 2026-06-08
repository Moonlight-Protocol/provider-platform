import { assertEquals } from "@std/assert";

/**
 * Verifies the core property the heartbeat patch depends on: a Deno-upgraded
 * WebSocket configured with `idleTimeout: N` stays OPEN past N seconds of
 * application-layer silence, because Deno auto-sends WS protocol-level ping
 * frames at ~N/2 cadence and the standard `WebSocket` client auto-responds
 * with pong frames at the protocol layer (no application code on either
 * side).
 *
 * This is the property `ws-handler.ts` relies on when we bumped
 * `IDLE_TIMEOUT_SECONDS` 30 → 60 to absorb testnet's inter-bundle pauses
 * (Stellar ledger close + Verifier polling > 30 s).
 *
 * Uses a deliberately small `idleTimeout` (4 s) so the test runs in
 * ~6 s instead of ~40 s; the property is the same.
 */
Deno.test(
  "WS stays OPEN past idleTimeout when no application messages are sent (Deno auto-ping keeps it alive)",
  async () => {
    const IDLE_TIMEOUT_SECONDS = 4;
    const WAIT_MS = (IDLE_TIMEOUT_SECONDS + 2) * 1000;

    const ac = new AbortController();
    const port = 18123 + Math.floor(performance.now() * 1000) % 1000;

    const ready = Promise.withResolvers<void>();

    const server = Deno.serve(
      { port, signal: ac.signal, onListen: () => ready.resolve() },
      (req) => {
        if (req.headers.get("upgrade") !== "websocket") {
          return new Response(null, { status: 501 });
        }
        const { socket: _socket, response } = Deno.upgradeWebSocket(req, {
          idleTimeout: IDLE_TIMEOUT_SECONDS,
        });
        return response;
      },
    );
    await ready.promise;

    const ws = new WebSocket(`ws://localhost:${port}/`);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = (e) =>
        reject(new Error(`ws error: ${(e as ErrorEvent).message ?? "?"}`));
    });

    // Wait past `idleTimeout` without sending any application messages.
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));

    assertEquals(
      ws.readyState,
      WebSocket.OPEN,
      `WS should still be OPEN after ${WAIT_MS} ms (idleTimeout ${IDLE_TIMEOUT_SECONDS}s); ` +
        `got readyState=${ws.readyState}. Deno auto-ping (protocol-level) ` +
        `should keep it alive when the client is responsive.`,
    );

    ws.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    ac.abort();
    try {
      await server.finished;
    } catch { /* aborted */ }
  },
);
