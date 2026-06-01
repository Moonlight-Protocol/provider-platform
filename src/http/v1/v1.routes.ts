import { Router } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";
import { buildStellarRouter } from "@/http/v1/stellar/routes.ts";
import { buildBundleRouter } from "@/http/v1/bundle/routes.ts";
import { buildDashboardRouter } from "@/http/v1/dashboard/routes.ts";
import { buildPayRouter } from "@/http/v1/pay/routes.ts";
import healthRouter from "@/http/v1/health/routes.ts";
import { buildWaitlistRouter } from "@/http/v1/waitlist/routes.ts";
import { buildCouncilRouter } from "@/http/v1/council/routes.ts";
import { buildEventsRouter } from "@/http/v1/events/routes.ts";
import { buildEntitiesRouter } from "@/http/v1/entities/routes.ts";
import { buildProvidersRouter } from "@/http/v1/providers/routes.ts";

export function buildApiRouter(deps: { log: Logger }): Router {
  const apiRouter = new Router();

  const stellarRouter = buildStellarRouter(deps);
  const bundleRouter = buildBundleRouter(deps);
  const dashboardRouter = buildDashboardRouter(deps);
  const payRouter = buildPayRouter(deps);
  const waitlistRouter = buildWaitlistRouter(deps);
  const councilRouter = buildCouncilRouter(deps);
  const eventsRouter = buildEventsRouter(deps);
  const entitiesRouter = buildEntitiesRouter(deps);
  const providersRouter = buildProvidersRouter(deps);

  apiRouter.use(
    "/api/v1",
    healthRouter.routes(),
    healthRouter.allowedMethods(),
  );
  apiRouter.use(
    "/api/v1",
    stellarRouter.routes(),
    stellarRouter.allowedMethods(),
  );
  apiRouter.use(
    "/api/v1",
    dashboardRouter.routes(),
    dashboardRouter.allowedMethods(),
  );
  apiRouter.use(
    "/api/v1",
    councilRouter.routes(),
    councilRouter.allowedMethods(),
  );
  apiRouter.use("/api/v1", payRouter.routes(), payRouter.allowedMethods());
  apiRouter.use(
    "/api/v1",
    bundleRouter.routes(),
    bundleRouter.allowedMethods(),
  );
  apiRouter.use(
    "/api/v1",
    waitlistRouter.routes(),
    waitlistRouter.allowedMethods(),
  );
  apiRouter.use(
    "/api/v1",
    eventsRouter.routes(),
    eventsRouter.allowedMethods(),
  );
  apiRouter.use(
    "/api/v1",
    entitiesRouter.routes(),
    entitiesRouter.allowedMethods(),
  );
  apiRouter.use(
    "/api/v1",
    providersRouter.routes(),
    providersRouter.allowedMethods(),
  );

  return apiRouter;
}
