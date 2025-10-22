import { selectNetwork } from "./network.ts";
import requireEnv from "../utils/env/requireEnv.ts";
import { requireSecretKey } from "../utils/env/requireSecretKey.ts";
import { requirePublicKey } from "../utils/env/requirePublicKey.ts";
import { LocalSigner, type TransactionConfig } from "@colibri/core";
import { requireBaseFee } from "../utils/env/requireBaseFee.ts";

// Every required variable is retrieved via requireEnv.

export const PORT = requireEnv("PORT");
export const MODE = requireEnv("MODE");
export const SERVICE_DOMAIN = requireEnv("SERVICE_DOMAIN");

export const CHALLENGE_TTL = Number(requireEnv("CHALLENGE_TTL"));
export const SESSION_TTL = Number(requireEnv("SESSION_TTL"));

// Moonlight
export const CHANEL_CONTRACT_ID = requireEnv("CHANEL_CONTRACT_ID");
export const CHANNEL_AUTH_ID = requireEnv("CHANNEL_AUTH_ID");

// ACCOUNTS
export const OPEX_SK = requireSecretKey("OPEX_SECRET");
const OPEX_PK = requirePublicKey("OPEX_PUBLIC");
export const PROVIDER_SK = requireSecretKey("PROVIDER_SK");

// Config
export const { NETWORK_CONFIG, NETWORK, POOL_ASSET } = selectNetwork(
  requireEnv("NETWORK")
);
const NETWORK_FEE = requireBaseFee("NETWORK_FEE");

export const OPEX_SIGNER = LocalSigner.fromSecret(OPEX_SK);

export const TX_CONFIG: TransactionConfig = {
  source: OPEX_PK,
  fee: NETWORK_FEE,
  timeout: 30,

  signers: [OPEX_SIGNER],
};

console.log(`Loaded ENV variables: PORT=${PORT}, MODE=${MODE}`);
