import {
  CHANEL_CONTRACT_ID,
  NETWORK,
  OPEX_SIGNER,
  OPEX_SK,
} from "../../config/env.ts";
import {
  UtxoBasedStellarAccount,
  StellarDerivator,
  UTXOStatus,
} from "@moonlight/moonlight-sdk";

console.log(".  > OPEX:", OPEX_SIGNER.publicKey());

export const OPEX = new UtxoBasedStellarAccount({
  root: OPEX_SK,
  derivator: new StellarDerivator().withNetworkAndContract(
    NETWORK,
    CHANEL_CONTRACT_ID
  ),
  options: {
    batchSize: 100,
  },
});

await OPEX.deriveBatch({ startIndex: 1, count: 5 });
await OPEX.batchLoad();

console.log(
  "LOADED:",
  OPEX.getAllUTXOs().length
  //   OPEX.getAllUTXOs().map((u) => `${u.index} - ${u.status}: ${u.balance}`)
);
console.log("Total Balance : ", OPEX.getTotalBalance());

console.log("LOADED FREE: ", OPEX.getUTXOsByState(UTXOStatus.FREE).length);
