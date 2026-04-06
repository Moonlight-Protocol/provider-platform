import { selectNetwork } from "@/config/network.ts";
import { requireEnv } from "@/utils/env/loadEnv.ts";
import { requireBaseFee } from "@/utils/env/requireBaseFee.ts";
import { LOG } from "@/config/logger.ts";
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
export const MEMPOOL_MAX_RETRY_ATTEMPTS = Number(requireEnv("MEMPOOL_MAX_RETRY_ATTEMPTS"));

// Event watcher
export const EVENT_WATCHER_INTERVAL_MS = Number(Deno.env.get("EVENT_WATCHER_INTERVAL_MS") ?? "30000");
