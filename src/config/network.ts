import {
  type ContractId,
  FutureNet,
  MainNet,
  type NetworkConfig,
  TestNet,
} from "@colibri/core";
import { StellarNetworkId } from "@moonlight/moonlight-sdk";

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
          code: "XLM",
          contractId:
            "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC" as ContractId,
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
      throw new Error("Invalid network configured: " + envNetwork);
  }
}
