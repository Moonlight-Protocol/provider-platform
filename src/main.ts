import { Application } from "@oak/oak";

import { globalRateLimitMiddleware } from "@/http/middleware/rate-limit/index.ts";
import apiVi from "@/http/v1/v1.routes.ts";
import { appendRequestIdMiddleware } from "@/http/middleware/append-request-id.ts";
import { appendResponseHeadersMiddleware } from "@/http/middleware/append-response-headers.ts";
import { traceContextMiddleware } from "@/http/middleware/trace-context.ts";
import { corsMiddleware } from "@/http/middleware/cors.ts";
import { PORT } from "@/config/env.ts";
import { LOG } from "@/config/logger.ts";
import { initializeMempoolSystem, shutdownMempoolSystem } from "@/core/mempool/index.ts";
import { startEventWatcher, stopEventWatcher } from "@/core/service/event-watcher/index.ts";

async function bootstrap() {
  try {
    // Initialize mempool system before starting HTTP server
    await initializeMempoolSystem();

    // Start watching for Channel Auth contract events (loaded from DB)
    await startEventWatcher();

    const app = new Application();

    app.use(corsMiddleware);
    app.use(traceContextMiddleware);
    app.use(globalRateLimitMiddleware);
    app.use(appendRequestIdMiddleware);
    app.use(appendResponseHeadersMiddleware);
    app.use(apiVi.routes());

    LOG.info(`Server running on http://localhost:${PORT}`);

    // Setup graceful shutdown
    const shutdown = () => {
      LOG.info("Shutting down server...");
      Promise.all([
        stopEventWatcher(),
        shutdownMempoolSystem(),
      ]).finally(() => Deno.exit(0));
    };

    Deno.addSignalListener("SIGINT", shutdown);
    Deno.addSignalListener("SIGTERM", shutdown);

    await app.listen({ port: Number(PORT) });
  } catch (error) {
    LOG.error("Failed to start server", {
      error: error instanceof Error ? error.message : String(error),
    });
    Promise.all([
      stopEventWatcher(),
      shutdownMempoolSystem(),
    ]).finally(() => Deno.exit(1));
  }
}

bootstrap();
