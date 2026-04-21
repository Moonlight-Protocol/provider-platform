import { selectNetwork } from "@/config/network.ts";
import { requireEnv, loadOptionalEnv } from "@/utils/env/loadEnv.ts";
import { requireBaseFee } from "@/utils/env/requireBaseFee.ts";
import { Server } from "stellar-sdk/rpc";

export const DATABASE_URL = requireEnv("DATABASE_URL");
export const PORT = requireEnv("PORT");
export const MODE = requireEnv("MODE");
export const SERVICE_DOMAIN = requireEnv("SERVICE_DOMAIN");
export const SERVICE_AUTH_SECRET = requireEnv("SERVICE_AUTH_SECRET");

export const CHALLENGE_TTL = Number(requireEnv("CHALLENGE_TTL"));
export const SESSION_TTL = Number(requireEnv("SESSION_TTL"));

// Network
export const { NETWORK_CONFIG, NETWORK } = selectNetwork(requireEnv("NETWORK"));
export const NETWORK_FEE = requireBaseFee("NETWORK_FEE");

export const NETWORK_RPC_SERVER = new Server(
  NETWORK_CONFIG.rpcUrl as string,
  { allowHttp: NETWORK_CONFIG.allowHttp },
);

// Mempool
export const MEMPOOL_SLOT_CAPACITY = Number(requireEnv("MEMPOOL_SLOT_CAPACITY"));
export const MEMPOOL_EXPENSIVE_OP_WEIGHT = Number(requireEnv("MEMPOOL_EXPENSIVE_OP_WEIGHT"));
export const MEMPOOL_CHEAP_OP_WEIGHT = Number(requireEnv("MEMPOOL_CHEAP_OP_WEIGHT"));
export const MEMPOOL_EXECUTOR_INTERVAL_MS = Number(requireEnv("MEMPOOL_EXECUTOR_INTERVAL_MS"));
export const MEMPOOL_VERIFIER_INTERVAL_MS = Number(requireEnv("MEMPOOL_VERIFIER_INTERVAL_MS"));
export const MEMPOOL_TTL_CHECK_INTERVAL_MS = Number(requireEnv("MEMPOOL_TTL_CHECK_INTERVAL_MS"));
// 0 = disabled; set e.g. 86400000 (24h) to auto-expire stale bundles on startup
const _rawStartupAge = Number(loadOptionalEnv("MEMPOOL_STARTUP_MAX_BUNDLE_AGE_MS") ?? "0");
if (!Number.isFinite(_rawStartupAge) || _rawStartupAge < 0) {
  throw new Error(
    `MEMPOOL_STARTUP_MAX_BUNDLE_AGE_MS must be a non-negative number, got: "${loadOptionalEnv("MEMPOOL_STARTUP_MAX_BUNDLE_AGE_MS")}"`
  );
}
export const MEMPOOL_STARTUP_MAX_BUNDLE_AGE_MS = _rawStartupAge;
const _rawMaxRetry = Number(requireEnv("MEMPOOL_MAX_RETRY_ATTEMPTS"));
if (!Number.isFinite(_rawMaxRetry) || !Number.isInteger(_rawMaxRetry) || _rawMaxRetry < 1) {
  throw new Error(
    `MEMPOOL_MAX_RETRY_ATTEMPTS must be a positive integer, got: "${requireEnv("MEMPOOL_MAX_RETRY_ATTEMPTS")}"`
  );
}
export const MEMPOOL_MAX_RETRY_ATTEMPTS = _rawMaxRetry;

// Bundle limits
const _rawMaxOps = Number(requireEnv("BUNDLE_MAX_OPERATIONS"));
if (!Number.isFinite(_rawMaxOps) || !Number.isInteger(_rawMaxOps) || _rawMaxOps < 1) {
  throw new Error(
    `BUNDLE_MAX_OPERATIONS must be a positive integer, got: "${requireEnv("BUNDLE_MAX_OPERATIONS")}"`
  );
}
export const BUNDLE_MAX_OPERATIONS = _rawMaxOps;

// Transaction expiration offset (ledger sequences ahead of latest ledger)
const _rawTxExpirationOffset = Number(loadOptionalEnv("TRANSACTION_EXPIRATION_OFFSET") ?? "1000");
if (!Number.isFinite(_rawTxExpirationOffset) || !Number.isInteger(_rawTxExpirationOffset) || _rawTxExpirationOffset < 1) {
  throw new Error(
    `TRANSACTION_EXPIRATION_OFFSET must be a positive integer, got: "${loadOptionalEnv("TRANSACTION_EXPIRATION_OFFSET")}"`
  );
}
export const TRANSACTION_EXPIRATION_OFFSET = _rawTxExpirationOffset;

// Event watcher
export const EVENT_WATCHER_INTERVAL_MS = Number(Deno.env.get("EVENT_WATCHER_INTERVAL_MS") ?? "30000");
