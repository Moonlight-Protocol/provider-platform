import { StellarPlus } from "stellar-plus";
import { NETWORK_CONFIG, STELLAR_SERVICE_SK } from "../../../config/env.ts";

export const STELLAR_SERVICE_ACCOUNT = new StellarPlus.Account
  .DefaultAccountHandler({
  networkConfig: NETWORK_CONFIG,
  secretKey: STELLAR_SERVICE_SK,
});
