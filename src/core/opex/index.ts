import {
  SelectionDirective,
  SPPAccount,
  UTXOPublicKey,
  StellarNetworkDerivation,
  StellarNetworkDerivatorFactory,
} from "@fifo/spp-sdk";
import {
  NETWORK,
  NETWORK_CONFIG,
  OPEX_HANDLER,
  POOL_CONTRACT_ID,
  TX_INVOCATION,
} from "../../config/env.ts";

import { POOL } from "../pool/index.ts";
import { Buffer } from "buffer";

console.log(`SECRET: ${OPEX_HANDLER.getSecretKey()}`);
export const OPEX = new SPPAccount<StellarNetworkDerivation>({
  networkConfig: NETWORK_CONFIG,
  secretKey: OPEX_HANDLER.getSecretKey(),
  derivatorFactory: StellarNetworkDerivatorFactory({
    network: NETWORK,
    smartContract: POOL_CONTRACT_ID,
  }),
  utxoBalances: (utxos: UTXOPublicKey[]) =>
    POOL.balances({
      utxos: utxos.map((u) => Buffer.from(u)),
      txInvocation: TX_INVOCATION,
    }),
  defaultSelectionDirective: SelectionDirective.OLDER_FIRST,
});

await OPEX.deriveAndLoad(200);
console.log(
  "LOADED: ",
  OPEX.getUTXOs().map((u) => `${u.sequence} - ${u.status}: ${u.balance}`)
);

console.log("LOADED FREE: ", OPEX.getFreeSequences());
