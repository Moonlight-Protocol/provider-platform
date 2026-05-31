import { Application } from "@oak/oak";

import { buildApiRouter } from "@/http/v1/v1.routes.ts";
import { appendRequestIdMiddleware } from "@/http/middleware/append-request-id.ts";
import { appendResponseHeadersMiddleware } from "@/http/middleware/append-response-headers.ts";
import { traceContextMiddleware } from "@/http/middleware/trace-context.ts";
import { corsMiddleware } from "@/http/middleware/cors.ts";
import { PORT } from "@/config/env.ts";
import { createLogger } from "@/config/logger.ts";
import { getEventBus } from "@/core/service/events/event-bus.ts";
import { getSessionManager } from "@/core/service/auth/sessions/in-memory-session-manager.ts";
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
  getEventBus(deps);
  getSessionManager(deps);

  try {
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
    ]).finally(() => Deno.exit(1));
  }
}

bootstrap();
