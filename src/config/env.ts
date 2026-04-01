import { selectNetwork } from "@/config/network.ts";
import { requireEnv, loadOptionalEnv } from "@/utils/env/loadEnv.ts";
import { requireSecretKey } from "@/utils/env/requireSecretKey.ts";
import { requirePublicKey } from "@/utils/env/requirePublicKey.ts";
import { LocalSigner, type TransactionConfig } from "@colibri/core";
import { requireBaseFee } from "@/utils/env/requireBaseFee.ts";
import { requireContractId } from "@/utils/env/requireContractId.ts";
import { Server } from "stellar-sdk/rpc";

// Every required variable is retrieved via requireEnv.

export const DATABASE_URL = requireEnv("DATABASE_URL");

export const PORT = requireEnv("PORT");
export const MODE = requireEnv("MODE");
export const SERVICE_DOMAIN = requireEnv("SERVICE_DOMAIN");
export const SERVICE_AUTH_SECRET = requireEnv("SERVICE_AUTH_SECRET");

export const CHALLENGE_TTL = Number(requireEnv("CHALLENGE_TTL"));
export const SESSION_TTL = Number(requireEnv("SESSION_TTL"));

// Mempool
export const MEMPOOL_SLOT_CAPACITY = Number(requireEnv("MEMPOOL_SLOT_CAPACITY"));
export const MEMPOOL_EXPENSIVE_OP_WEIGHT = Number(requireEnv("MEMPOOL_EXPENSIVE_OP_WEIGHT"));
export const MEMPOOL_CHEAP_OP_WEIGHT = Number(requireEnv("MEMPOOL_CHEAP_OP_WEIGHT"));
export const MEMPOOL_EXECUTOR_INTERVAL_MS = Number(requireEnv("MEMPOOL_EXECUTOR_INTERVAL_MS"));
export const MEMPOOL_VERIFIER_INTERVAL_MS = Number(requireEnv("MEMPOOL_VERIFIER_INTERVAL_MS"));
export const MEMPOOL_TTL_CHECK_INTERVAL_MS = Number(requireEnv("MEMPOOL_TTL_CHECK_INTERVAL_MS"));
// 0 = disabled; set e.g. 86400000 (24h) to auto-expire stale bundles on startup
export const MEMPOOL_STARTUP_MAX_BUNDLE_AGE_MS =
  Number(loadOptionalEnv("MEMPOOL_STARTUP_MAX_BUNDLE_AGE_MS") ?? "0");
const _rawMaxRetry = Number(requireEnv("MEMPOOL_MAX_RETRY_ATTEMPTS"));
if (!Number.isFinite(_rawMaxRetry) || !Number.isInteger(_rawMaxRetry) || _rawMaxRetry < 1) {
  throw new Error(
    `MEMPOOL_MAX_RETRY_ATTEMPTS must be a positive integer, got: "${requireEnv("MEMPOOL_MAX_RETRY_ATTEMPTS")}"`
  );
}
export const MEMPOOL_MAX_RETRY_ATTEMPTS = _rawMaxRetry;

// Moonlight
export const CHANNEL_CONTRACT_ID = requireContractId("CHANNEL_CONTRACT_ID");
export const CHANNEL_AUTH_ID = requireContractId("CHANNEL_AUTH_ID");

// ACCOUNTS
export const OPEX_SK = requireSecretKey("OPEX_SECRET");
const OPEX_PK = requirePublicKey("OPEX_PUBLIC");
export const PROVIDER_SK = requireSecretKey("PROVIDER_SK");

// Config
export const { NETWORK_CONFIG, NETWORK, CHANNEL_ASSET } = selectNetwork(
  requireEnv("NETWORK")
);
const NETWORK_FEE = requireBaseFee("NETWORK_FEE");

export const NETWORK_RPC_SERVER = new Server(NETWORK_CONFIG.rpcUrl as string, { allowHttp: NETWORK_CONFIG.allowHttp });

export const OPEX_SIGNER = LocalSigner.fromSecret(OPEX_SK);
export const PROVIDER_SIGNER = LocalSigner.fromSecret(PROVIDER_SK);

export const TX_CONFIG: TransactionConfig = {
  source: OPEX_PK,
  fee: NETWORK_FEE,
  timeout: 30,
  signers: [OPEX_SIGNER],
};
