import { ProcessEngine } from "@fifo/convee";
import type { ContextWithParsedPayload } from "../../../http/utils/parse-request-payload.ts";

import type { RawBundle } from "../../../models/bundle/bundle.schema.ts";
import type { Bundle } from "@/models/bundle/bundle.schema.ts";
import { UtxoStatus } from "@/models/utxo/utxo.schema.ts";

import { Buffer } from "buffer";
import { sha256Hash } from "@/utils/crypto/sha256.ts";
import type { PostBundlePayload } from "@/http/v1/bundle/post.schema.ts";

export const PROCESS_NEW_BUNDLE = ProcessEngine.create(
  async (input: ContextWithParsedPayload<PostBundlePayload>) => {
    // const rawBundle = input.payload.bundle;
    // const ctx = input.ctx;
    // const sessionData = ctx.state.session as JwtSessionData;
    // const bundle = await formatBundle(rawBundle);

    // const loadedBundle = await memDb.bundles.findByPrimaryIndex(
    //   "hash",
    //   bundle.hash
    // );
    // console.log("Loaded Bundle: ", loadedBundle);
    // if (loadedBundle !== null) {
    //   throw new Error("Invalid Bundle: Bundle already exists");
    // }

    // console.log("MOCK TRANSACT!");
    // const txHash = bundle.hash;
    // console.log("TX hash mocked as bundle hash: ", bundle.hash);
    // console.log("change: ", 1n);

    // const cr = await db.bundles.add({
    //   createdAt: new Date(),
    //   updatedAt: new Date(),
    //   hash: bundle.hash,
    //   status: "confirmed",
    //   feeCharged: 1n.toString(),
    //   clientAccount: sessionData.sub,
    //   txHash: txHash,
    // });

    // if (!cr.ok) {
    //   throw new Error("Error storing bundle");
    // }

    // console.log("Bundle created: ", bundle.hash);
    // console.log(
    //   "Bundle obj: ",
    //   (await db.bundles.findByPrimaryIndex("hash", bundle.hash))?.value
    // );

    // return { ctx, transactionHash: txHash, bundleHash: bundle.hash };
    return await input;
  },
  {
    name: "ProcessNewBundleProcessEngine",
  }
);

const formatBundle = async (rawBundle: RawBundle): Promise<Bundle> => {
  const bundlBufferPreHash = Buffer.from(JSON.stringify(rawBundle)); // MOCK

  const bundleHash = await sha256Hash(bundlBufferPreHash);

  const createUtxos = rawBundle.create.map(([pk, amount]) => {
    return {
      publicKey: Buffer.from(pk).toString("base64"),
      amount: amount,
      status: UtxoStatus.enum.unspent,
      bundleCreateHash: bundleHash,
    };
  });

  const spendUtxos = rawBundle.spend.map((pk) => {
    return {
      publicKey: Buffer.from(pk).toString("base64"),
      amount: 0n,
      status: UtxoStatus.enum.spent,
      bundleSpendHash: bundleHash,
    };
  });

  return {
    hash: bundleHash,
    create: createUtxos,
    spend: spendUtxos,
  };
};
