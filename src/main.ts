import { Application } from "@oak/oak";

import { globalRateLimitMiddleware } from "./http/middleware/rate-limit.ts";
import apiVi from "./http/v1/v1.routes.ts";
import { appendRequestIdMiddleware } from "./http/middleware/append-request-id.ts";
import { appendResponseHeadersMiddleware } from "./http/middleware/append-response-headers.ts";

import { PORT } from "@/config/env.ts";
import { LOG } from "@/config/logger.ts";

async function bootstrap() {
  const app = new Application();

  app.use(globalRateLimitMiddleware);
  app.use(appendRequestIdMiddleware);
  app.use(appendResponseHeadersMiddleware);
  app.use(apiVi.routes());

  LOG.info(`🚀 Executer Server running on http://localhost:${PORT}`);

  await app.listen({ port: Number(PORT) });
}

bootstrap();
