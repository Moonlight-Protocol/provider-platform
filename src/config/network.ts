import { NetworkConfig, NetworkProviders } from "@colibri/core";
import { StellarNetworkId } from "@moonlight/moonlight-sdk";
import * as E from "@/config/error.ts";
import { logAndThrow } from "@/utils/error/log-and-throw.ts";
import { loadOptionalEnv } from "@/utils/env/loadEnv.ts";

export function selectNetwork(envNetwork: string): {
  NETWORK_CONFIG: NetworkConfig;
  NETWORK: StellarNetworkId;
} {
  switch (envNetwork) {
    case "mainnet": {
      const rpcUrl = loadOptionalEnv("STELLAR_RPC_URL") ??
        "https://soroban-rpc.mainnet.stellar.gateway.fm";
      return {
        NETWORK_CONFIG: NetworkConfig.CustomNet({
          networkPassphrase: "Public Global Stellar Network ; September 2015",
          rpcUrl,
          horizonUrl: "https://horizon.stellar.org",
          allowHttp: false,
        }),
        NETWORK: "Public Global Stellar Network ; September 2015" as StellarNetworkId,
      };
    }
    case "testnet":
      return {
        NETWORK_CONFIG: NetworkProviders.Nodies.TestNet(),
        NETWORK: StellarNetworkId.Testnet,
      };
    case "local": {
      const rpcUrl = loadOptionalEnv("STELLAR_RPC_URL") ??
        "http://localhost:8000/soroban/rpc";
      const horizonUrl = rpcUrl.replace("/soroban/rpc", "");
      return {
        NETWORK_CONFIG: NetworkConfig.CustomNet({
          networkPassphrase: "Standalone Network ; February 2017",
          rpcUrl,
          horizonUrl,
          friendbotUrl: `${horizonUrl}/friendbot`,
          allowHttp: true,
        }),
        NETWORK: "Standalone Network ; February 2017" as StellarNetworkId,
      };
    }
    default:
      logAndThrow(new E.INVALID_NETWORK());
  }
}
