import { Router } from "@oak/oak";
import bundleRouter from "@/http/v1/bundle/routes.ts";

import stellarRouter from "@/http/v1/stellar/routes.ts";
import transactionsRouter from "./transactions/routes.ts";

const apiVi = new Router();

apiVi.use("/api/v1", stellarRouter.routes(), stellarRouter.allowedMethods());

apiVi.use("/api/v1", bundleRouter.routes(), bundleRouter.allowedMethods());
apiVi.use(
  "/api/v1",
  transactionsRouter.routes(),
  transactionsRouter.allowedMethods()
);
export default apiVi;
