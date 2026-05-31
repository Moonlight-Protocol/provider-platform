import { Router } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";
import { handlePostEntity } from "./post.ts";

export function buildEntitiesRouter(deps: { log: Logger }): Router {
  const entitiesRouter = new Router();
  // Public — KYC/KYB-style entity registration. Auto-accept on submit.
  entitiesRouter.post("/entities", handlePostEntity(deps));
  return entitiesRouter;
}
