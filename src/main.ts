import { Application } from "@oak/oak";

import { buildApiRouter } from "@/http/v1/v1.routes.ts";
import { appendRequestIdMiddleware } from "@/http/middleware/append-request-id.ts";
import { appendResponseHeadersMiddleware } from "@/http/middleware/append-response-headers.ts";
import { traceContextMiddleware } from "@/http/middleware/trace-context.ts";
import { corsMiddleware } from "@/http/middleware/cors.ts";
import { PORT } from "@/config/env.ts";
import { createLogger } from "@/config/logger.ts";
import {
  getEventBus,
  PROVIDER_EVENTS_CHANNEL,
} from "@/core/service/events/pg-notify-event-bus.ts";
import { startPgListener } from "@/core/service/events/pg-listener.ts";
import { getSessionManager } from "@/core/service/auth/sessions/in-memory-session-manager.ts";
import { pgClient } from "@/persistence/drizzle/config.ts";
import {
  initializeMempoolSystem,
  shutdownMempoolSystem,
} from "@/core/mempool/index.ts";
import {
  startEventWatcher,
  stopEventWatcher,
} from "@/core/service/event-watcher/index.ts";

async function bootstrap() {
  const rootLog = createLogger();
  const log = rootLog.scope("bootstrap");
  log.info("bootstrap");

  const deps = { log: rootLog };

  // Initialize lazy singletons that depend on the root logger.
  const eventBus = getEventBus(deps);
  getSessionManager(deps);

  let stopPgListener: (() => Promise<void>) | null = null;

  try {
    // Wire the cross-machine event transport BEFORE anything emits. Order
    // matters: pgListener must be subscribed first so the very first emit
    // round-trips successfully, then setSql flips the bus from loopback to
    // NOTIFY mode.
    stopPgListener = await startPgListener({ log: rootLog, bus: eventBus });
    eventBus.setNotifier((payload) =>
      pgClient.notify(PROVIDER_EVENTS_CHANNEL, payload)
    );

    await initializeMempoolSystem(deps);
    await startEventWatcher(deps);

    const app = new Application();

    app.use(corsMiddleware);
    app.use(traceContextMiddleware);
    app.use(appendRequestIdMiddleware(deps));
    app.use(appendResponseHeadersMiddleware);
    const apiV1 = buildApiRouter(deps);
    app.use(apiV1.routes());

    log.debug("port", PORT);
    log.event(`server running on http://localhost:${PORT}`);

    const shutdown = () => {
      log.event("shutting down server");
      Promise.all([
        stopEventWatcher(),
        shutdownMempoolSystem(deps),
        stopPgListener ? stopPgListener() : Promise.resolve(),
      ]).finally(() => Deno.exit(0));
    };

    Deno.addSignalListener("SIGINT", shutdown);
    Deno.addSignalListener("SIGTERM", shutdown);

    await app.listen({ port: Number(PORT) });
  } catch (error) {
    log.error(error, "failed to start server");
    Promise.all([
      stopEventWatcher(),
      shutdownMempoolSystem(deps),
      stopPgListener ? stopPgListener() : Promise.resolve(),
    ]).finally(() => Deno.exit(1));
  }
}

bootstrap();
