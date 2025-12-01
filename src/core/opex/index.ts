import {
  CHANEL_CONTRACT_ID,
  NETWORK,
  OPEX_SIGNER,
  OPEX_SK,
} from "@/config/env.ts";
import {
  UtxoBasedStellarAccount,
  StellarDerivator,
  UTXOStatus,
  type UTXOPublicKey,
  ChannelReadMethods,
} from "@moonlight/moonlight-sdk";
import { CHANNEL_CLIENT } from "@/core/channel-client/index.ts";
import { Buffer } from "node:buffer";
import { LOG } from "@/config/logger.ts";

LOG.debug(".  > OPEX:", OPEX_SIGNER.publicKey());

export const OPEX = new UtxoBasedStellarAccount({
  root: OPEX_SK,
  derivator: new StellarDerivator().withNetworkAndContract(
    NETWORK,
    CHANEL_CONTRACT_ID
  ),

  options: {
    batchSize: 100,
    fetchBalances: (utxos: UTXOPublicKey[]) =>
      CHANNEL_CLIENT.read({
        method: ChannelReadMethods.utxo_balances,
        methodArgs: {
          utxos: utxos.map((u) => Buffer.from(u)),
        },
      }),
  },
});

await OPEX.deriveBatch({ startIndex: 1, count: 5 });
await OPEX.batchLoad();

LOG.debug(
  "LOADED:",
  OPEX.getAllUTXOs().length
  //   OPEX.getAllUTXOs().map((u) => `${u.index} - ${u.status}: ${u.balance}`)
);
LOG.debug("Total Balance : ", OPEX.getTotalBalance());

LOG.debug("LOADED FREE: ", OPEX.getUTXOsByState(UTXOStatus.FREE).length);
