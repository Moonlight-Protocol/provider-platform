import { TX_CONFIG } from "../../config/env.ts";
import { RawBundle } from "../../models/bundle/bundle.schema.ts";

import { Buffer } from "buffer";

export async function calculateChange(bundle: RawBundle): Promise<bigint> {
  // const spendingArray = await POOL.balances({
  //   utxos: bundle.spend.map((s) => Buffer.from(s)),
  //   txInvocation: TX_INVOCATION,
  // });

  // const spending = spendingArray.reduce(
  //   (accumulator, currentValue) => accumulator + currentValue,
  //   0n,
  // );

  // let creating = 0n;

  // for (const createItem of bundle.create) {
  //   creating += createItem[1];
  // }

  // return spending - creating;

  return 0n;
}
