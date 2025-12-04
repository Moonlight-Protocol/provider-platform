import { Router } from "@oak/oak";

import stellarRouter from "@/http/v1/stellar/routes.ts";

const apiVi = new Router();

apiVi.use("/api/v1", stellarRouter.routes(), stellarRouter.allowedMethods());

export default apiVi;
