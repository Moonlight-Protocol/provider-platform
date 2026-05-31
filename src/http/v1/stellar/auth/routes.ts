import { Router } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";
import { handlePostAuth } from "@/http/v1/stellar/auth/post.ts";
import { handleGetAuth } from "@/http/v1/stellar/auth/get.ts";

export function buildAuthRouter(deps: { log: Logger }): Router {
  const authRouter = new Router();
  authRouter.post("/auth", handlePostAuth(deps));
  authRouter.get("/auth", handleGetAuth(deps));
  return authRouter;
}
