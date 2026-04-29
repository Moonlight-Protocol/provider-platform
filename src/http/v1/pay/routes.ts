import { Router } from "@oak/oak";
import { jwtMiddleware } from "@/http/middleware/auth/index.ts";
import { getKycHandler } from "@/http/v1/pay/kyc/get.ts";
import { postKycHandler } from "@/http/v1/pay/kyc/post.ts";
import { listTransactionsHandler } from "@/http/v1/pay/transactions/list.ts";
import { postSelfBalanceHandler } from "@/http/v1/pay/self/balance.ts";
import { postSelfSendHandler } from "@/http/v1/pay/self/send.ts";
import { getCustodialAccountHandler } from "@/http/v1/pay/custodial/account.ts";
import { postCustodialSendHandler } from "@/http/v1/pay/custodial/send.ts";
import { postCustodialLoginHandler } from "@/http/v1/pay/custodial/login.ts";
import { postCustodialRegisterHandler } from "@/http/v1/pay/custodial/register.ts";
import { postSimulateKycHandler } from "@/http/v1/pay/demo/simulate-kyc.ts";
import { getEscrowSummaryHandler } from "@/http/v1/pay/escrow/summary.ts";
import { postReportHandler } from "@/http/v1/pay/report/post.ts";
import { LOG } from "@/config/logger.ts";
import { loadOptionalEnv } from "@/utils/env/loadEnv.ts";

const payRouter = new Router();

// --- Public auth endpoints (no JWT) ---
payRouter.post("/pay/custodial/login", postCustodialLoginHandler);
payRouter.post("/pay/custodial/register", postCustodialRegisterHandler);

// --- Authenticated endpoints ---
payRouter.get("/pay/kyc/:address", jwtMiddleware, getKycHandler);
payRouter.post("/pay/kyc", jwtMiddleware, postKycHandler);
payRouter.get("/pay/transactions", jwtMiddleware, listTransactionsHandler);
payRouter.post("/pay/self/balance", jwtMiddleware, postSelfBalanceHandler);
payRouter.post("/pay/self/send", jwtMiddleware, postSelfSendHandler);
payRouter.get(
  "/pay/custodial/account",
  jwtMiddleware,
  getCustodialAccountHandler,
);
payRouter.post("/pay/custodial/send", jwtMiddleware, postCustodialSendHandler);
payRouter.get("/pay/escrow/:address", jwtMiddleware, getEscrowSummaryHandler);
payRouter.post("/pay/report", jwtMiddleware, postReportHandler);

// --- Demo endpoints (local/standalone only) ---
const networkEnv = loadOptionalEnv("NETWORK") ?? "";
const demoEnabled = loadOptionalEnv("PAY_DEMO_ENABLED") === "true";
if (networkEnv === "local" || networkEnv === "standalone" || demoEnabled) {
  LOG.info("Pay demo routes enabled", { network: networkEnv, demoEnabled });
  payRouter.post(
    "/pay/demo/simulate-kyc",
    jwtMiddleware,
    postSimulateKycHandler,
  );
} else {
  LOG.info("Pay demo routes disabled (non-local network)", {
    network: networkEnv,
  });
}

export default payRouter;
