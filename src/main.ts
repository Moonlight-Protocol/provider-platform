import { Application } from "@oak/oak";

import { globalRateLimitMiddleware } from "@/http/middleware/rate-limit/index.ts";
import apiVi from "@/http/v1/v1.routes.ts";
import { appendRequestIdMiddleware } from "@/http/middleware/append-request-id.ts";
import { appendResponseHeadersMiddleware } from "@/http/middleware/append-response-headers.ts";
import { PORT } from "@/config/env.ts";
import { LOG } from "@/config/logger.ts";
import { initializeMempoolSystem, shutdownMempoolSystem } from "@/core/mempool/index.ts";

async function bootstrap() {
  try {
    // Initialize mempool system before starting HTTP server
    await initializeMempoolSystem();

    const app = new Application();

    app.use(globalRateLimitMiddleware);
    app.use(appendRequestIdMiddleware);
    app.use(appendResponseHeadersMiddleware);
    app.use(apiVi.routes());

    LOG.info(`🚀 Executer Server running on http://localhost:${PORT}`);

    // Setup graceful shutdown
    const shutdown = () => {
      LOG.info("Shutting down server...");
      shutdownMempoolSystem();
      Deno.exit(0);
    };

    Deno.addSignalListener("SIGINT", shutdown);
    Deno.addSignalListener("SIGTERM", shutdown);

    await app.listen({ port: Number(PORT) });
  } catch (error) {
    LOG.error("Failed to start server", {
      error: error instanceof Error ? error.message : String(error),
    });
    shutdownMempoolSystem();
    Deno.exit(1);
  }
}

bootstrap();
