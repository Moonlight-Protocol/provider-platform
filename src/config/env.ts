import { selectNetwork } from "./network.ts";
import { TransactionInvocation } from "stellar-plus/lib/stellar-plus/types";
import { StellarPlus } from "stellar-plus";
import requireEnv from "../utils/env/requireEnv.ts";

// Every required variable is retrieved via requireEnv.
export const PORT = requireEnv("PORT");
export const MODE = requireEnv("MODE");
export const SERVICE_DOMAIN = requireEnv("SERVICE_DOMAIN");

export const CHALLENGE_TTL = Number(requireEnv("CHALLENGE_TTL"));
export const SESSION_TTL = Number(requireEnv("SESSION_TTL"));

export const OPEX_SK = requireEnv("OPEX_SECRET");
const OPEX_PK = requireEnv("OPEX_PUBLIC");

export const STELLAR_SERVICE_SK = requireEnv("STELLAR_SERVICE_SK");

export const { NETWORK_CONFIG, NETWORK, POOL_ASSET } = selectNetwork(
  requireEnv("NETWORK"),
);
export const POOL_CONTRACT_ID = requireEnv("POOL_CONTRACT_ID");
const NETWORK_FEE = requireEnv("NETWORK_FEE");

export const OPEX_HANDLER = new StellarPlus.Account.DefaultAccountHandler({
  networkConfig: NETWORK_CONFIG,
  secretKey: OPEX_SK,
});

export const TX_INVOCATION: TransactionInvocation = {
  header: {
    source: OPEX_PK,
    fee: NETWORK_FEE,
    timeout: 30,
  },
  signers: [OPEX_HANDLER],
};

console.log(`Loaded ENV variables: PORT=${PORT}, MODE=${MODE}`);
