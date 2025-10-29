import { Router } from "@oak/oak";
import { jwtMiddleware } from "../../middleware/auth/index.ts";
import { getTransactionsEndpoint } from "./get.process.ts";

const transactionsRouter = new Router();

transactionsRouter.get("/transactions", jwtMiddleware, getTransactionsEndpoint);

export default transactionsRouter;
