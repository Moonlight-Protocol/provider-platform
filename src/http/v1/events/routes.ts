import { Router } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";
import { handleEventsWs } from "./ws-handler.ts";

export function buildEventsRouter(deps: { log: Logger }): Router {
  const eventsRouter = new Router();
  eventsRouter.get("/events/ws", handleEventsWs(deps));
  return eventsRouter;
}
