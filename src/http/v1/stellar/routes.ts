import { Router } from "@oak/oak";
import authRouter from "./auth/routes.ts";

const stellarRouter = new Router();

stellarRouter.use("/stellar", authRouter.routes(), authRouter.allowedMethods());

export default stellarRouter;
