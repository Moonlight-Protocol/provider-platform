import { Router } from "@oak/oak";
import { jwtMiddleware } from "@/http/middleware/auth/index.ts";
import { handleGetKyc } from "@/http/v1/pay/kyc/get.ts";
import { handlePostKyc } from "@/http/v1/pay/kyc/post.ts";
import { handleListTransactions } from "@/http/v1/pay/transactions/list.ts";
import { handlePostSelfBalance } from "@/http/v1/pay/self/balance.ts";
import { handlePostSelfSend } from "@/http/v1/pay/self/send.ts";
import { handleGetCustodialAccount } from "@/http/v1/pay/custodial/account.ts";
import { handlePostCustodialSend } from "@/http/v1/pay/custodial/send.ts";
import { handlePostCustodialLogin } from "@/http/v1/pay/custodial/login.ts";
import { handlePostCustodialRegister } from "@/http/v1/pay/custodial/register.ts";
import { handleGetEscrowSummary } from "@/http/v1/pay/escrow/summary.ts";
import { handlePostReport } from "@/http/v1/pay/report/post.ts";
import type { Logger } from "@/utils/logger/index.ts";

export function buildPayRouter(deps: { log: Logger }): Router {
  const payRouter = new Router();

  // --- Public auth endpoints (no JWT) ---
  payRouter.post("/pay/custodial/login", handlePostCustodialLogin(deps));
  payRouter.post("/pay/custodial/register", handlePostCustodialRegister(deps));

  // --- Authenticated endpoints ---
  payRouter.get("/pay/kyc/:address", jwtMiddleware(deps), handleGetKyc(deps));
  payRouter.post("/pay/kyc", jwtMiddleware(deps), handlePostKyc(deps));
  payRouter.get(
    "/pay/transactions",
    jwtMiddleware(deps),
    handleListTransactions(deps),
  );
  payRouter.post(
    "/pay/self/balance",
    jwtMiddleware(deps),
    handlePostSelfBalance(deps),
  );
  payRouter.post(
    "/pay/self/send",
    jwtMiddleware(deps),
    handlePostSelfSend(deps),
  );
  payRouter.get(
    "/pay/custodial/account",
    jwtMiddleware(deps),
    handleGetCustodialAccount(deps),
  );
  payRouter.post(
    "/pay/custodial/send",
    jwtMiddleware(deps),
    handlePostCustodialSend(deps),
  );
  payRouter.get(
    "/pay/escrow/:address",
    jwtMiddleware(deps),
    handleGetEscrowSummary(deps),
  );
  payRouter.post("/pay/report", jwtMiddleware(deps), handlePostReport(deps));

  return payRouter;
}
