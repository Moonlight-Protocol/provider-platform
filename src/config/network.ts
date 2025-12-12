import { type ContractId, type NetworkConfig, TestNet } from "@colibri/core";
import { StellarNetworkId } from "@moonlight/moonlight-sdk";
import * as E from "@/config/error.ts";
import { logAndThrow } from "@/utils/error/log-and-throw.ts";
import { requireEnv } from "@/utils/env/loadEnv.ts";
import { requireContractId } from "@/utils/env/requireContractId.ts";

export function selectNetwork(envNetwork: string): {
  NETWORK_CONFIG: NetworkConfig;
  NETWORK: StellarNetworkId;
  CHANNEL_ASSET: { code: string; contractId: ContractId };
} {
  switch (envNetwork) {
    case "testnet":
      return {
        NETWORK_CONFIG: TestNet(),
        NETWORK: StellarNetworkId.Testnet,
        CHANNEL_ASSET: {
          code: requireEnv("CHANNEL_ASSET_CODE"),
          contractId: requireContractId("CHANNEL_CONTRACT_ID") as ContractId,
        },
      };
    case "mainnet":
    // return {
    //   NETWORK_CONFIG: MainNet(),
    //   NETWORK: StellarNetworkId.Mainnet,
    //   CHANNEL_ASSET: { code: "XLM", contractId: "Not Defined" },
    // };
    case "futurenet":
    // return {
    //   NETWORK_CONFIG: FutureNet(),
    //   NETWORK: StellarNetworkId.Futurenet,
    //   CHANNEL_ASSET: { code: "XLM", contractId: "Not Defined" },
    // };
    default:
      logAndThrow(new E.INVALID_NETWORK());
  }
}
