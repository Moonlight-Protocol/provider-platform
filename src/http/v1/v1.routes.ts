import { Router } from "@oak/oak";

import stellarRouter from "@/http/v1/stellar/routes.ts";
import bundleRouter from "@/http/v1/bundle/routes.ts";

const apiRouter = new Router();

apiRouter.use("/api/v1", stellarRouter.routes(), stellarRouter.allowedMethods());
apiRouter.use("/api/v1", bundleRouter.routes(), bundleRouter.allowedMethods());

export default apiRouter;
