import {
  FutureNet,
  MainNet,
  NetworkConfig,
  TestNet,
} from "stellar-plus/lib/stellar-plus/network/index.js";
import { StellarNetwork } from "@fifo/spp-sdk";
export function selectNetwork(envNetwork: string): {
  NETWORK_CONFIG: NetworkConfig;
  NETWORK: StellarNetwork;
  POOL_ASSET: { code: string; contractId: string };
} {
  switch (envNetwork) {
    case "testnet":
      return {
        NETWORK_CONFIG: TestNet(),
        NETWORK: StellarNetwork.Testnet,
        POOL_ASSET: {
          code: "XLM",
          contractId:
            "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        },
      };
    case "mainnet":
      return {
        NETWORK_CONFIG: MainNet(),
        NETWORK: StellarNetwork.Mainnet,
        POOL_ASSET: { code: "XLM", contractId: "Not Defined" },
      };
    case "futurenet":
      return {
        NETWORK_CONFIG: FutureNet(),
        NETWORK: StellarNetwork.Futurenet,
        POOL_ASSET: { code: "XLM", contractId: "Not Defined" },
      };
    default:
      throw new Error("Invalid network configured: " + envNetwork);
  }
}
