import { OPEX_SIGNER } from "../../config/env.ts";

console.log("==>> TODO: Enable OPEX account for Moonlight UTXO management");
console.log(".  > OPEX:", OPEX_SIGNER.publicKey());

// export const OPEX = new SPPAccount<StellarNetworkDerivation>({
//   networkConfig: NETWORK_CONFIG,
//   secretKey: OPEX_HANDLER.getSecretKey(),
//   derivatorFactory: StellarNetworkDerivatorFactory({
//     network: NETWORK,
//     smartContract: CHANEL_CONTRACT_ID,
//   }),
//   utxoBalances: (utxos: UTXOPublicKey[]) =>
//     POOL.balances({
//       utxos: utxos.map((u) => Buffer.from(u)),
//       txInvocation: TX_INVOCATION,
//     }),
//   defaultSelectionDirective: SelectionDirective.OLDER_FIRST,
// });

// await OPEX.deriveAndLoad(200);
// console.log(
//   "LOADED: ",
//   OPEX.getUTXOs().map((u) => `${u.sequence} - ${u.status}: ${u.balance}`)
// );

// console.log("LOADED FREE: ", OPEX.getFreeSequences());
