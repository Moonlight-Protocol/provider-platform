import { Application } from "@oak/oak";

import { globalRateLimitMiddleware } from "../api/middleware/rate-limit.ts";
import apiVi from "../api/v1/v1.routes.ts";
import { appendRequestIdMiddleware } from "../api/middleware/appendRequestId.ts";
import { appendResponseHeadersMiddleware } from "../api/middleware/appendResponseHeaders.ts";

const app = new Application();

app.use(globalRateLimitMiddleware);
app.use(appendRequestIdMiddleware);
app.use(appendResponseHeadersMiddleware);
app.use(apiVi.routes());

export default app;
