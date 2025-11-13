import { LocalSigner } from "@colibri/core";
import { NETWORK_CONFIG, PROVIDER_SK } from "@/config/env.ts";

// export const STELLAR_SERVICE_ACCOUNT =
//   new StellarPlus.Account.DefaultAccountHandler({
//     networkConfig: NETWORK_CONFIG,
//     secretKey: PROVIDER_SK,
//   });

export const PROVIDER_ACCOUNT = LocalSigner.fromSecret(PROVIDER_SK);
