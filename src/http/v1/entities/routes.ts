import { Router } from "@oak/oak";
import { postEntityHandler } from "./post.ts";

const entitiesRouter = new Router();

// Public — KYC/KYB-style entity registration. Auto-accept on submit.
entitiesRouter.post("/entities", postEntityHandler);

export default entitiesRouter;
