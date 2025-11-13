import { Router } from "@oak/oak";
import authRouter from "@/http/v1/stellar/auth/routes.ts";

const stellarRouter = new Router();

stellarRouter.use("/stellar", authRouter.routes(), authRouter.allowedMethods());

export default stellarRouter;
