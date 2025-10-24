import { ProcessEngine } from "@fifo/convee";
import { PostBundlePayload } from "../../../api/v1/bundle/post.schema.ts";
import { ContextWithParsedPayload } from "../../../api/utils/parse-request-payload.ts";
import { db } from "../../../db/config.ts";
import { POOL } from "../../pool/index.ts";
import {
  convertRawBundleToBuffer,
  RawBundle,
} from "../../../models/bundle/bundle.schema.ts";
import { Bundle } from "../../../models/bundle/bundle.schema.ts";
import { UTXO, UtxoStatus } from "../../../models/utxo/utxo.schema.ts";
import { calculateChange } from "../calculate-change.ts";
import { JwtSessionData } from "../../../api/middleware/auth/index.ts";

import { OPEX } from "../../opex/index.ts";
import { Buffer } from "buffer";
import { sha256Hash } from "@fifo/spp-sdk";

export const PROCESS_NEW_BUNDLE = ProcessEngine.create(
  async (input: ContextWithParsedPayload<PostBundlePayload>) => {
    const rawBundle = input.payload.bundle;
    const ctx = input.ctx;
    const sessionData = ctx.state.session as JwtSessionData;
    const bundle = await formatBundle(rawBundle);

    const loadedBundle = await db.bundles.findByPrimaryIndex(
      "hash",
      bundle.hash
    );
    console.log("Loaded Bundle: ", loadedBundle);
    if (loadedBundle !== null) {
      throw new Error("Invalid Bundle: Bundle already exists");
    }

    const change = await calculateChange(rawBundle);

    const reserved = await OPEX.reserveUTXOs(1);

    if (!reserved) {
      throw new Error("Insufficient OPEX UTXOs to process bundle");
    }

    const feeUTXO = reserved[0];

    const res = await POOL.delegatedTransfer({
      bundles: [convertRawBundleToBuffer(rawBundle)],
      delegate_utxo: Buffer.from(delegateUtxo.keypair.publicKey),
      txInvocation: TX_INVOCATION,
      options: {
        includeHashOutput: true,
      },
    }).catch((error) => {
      throw new Error("Error transferring bundle");
    });

    const txHash = (res as any).hash as string;
    OPEX.updateAndReleaseUtxos(selected).then(() => {
      console.log("Updated OPEX UTXO");
      console.log("Balance: ", OPEX.getUnspentBalance());
    });

    const cr = await db.bundles.add({
      createdAt: new Date(),
      updatedAt: new Date(),
      hash: bundle.hash,
      status: "confirmed",
      feeCharged: change.toString(),
      clientAccount: sessionData.sub,
      delegateUtxo: Buffer.from(delegateUtxo.keypair.publicKey).toString(
        "base64"
      ),
      txHash: txHash,
    });

    if (!cr.ok) {
      throw new Error("Error storing bundle");
    }

    console.log("Bundle created: ", bundle.hash);
    console.log(
      "Bundle obj: ",
      (await db.bundles.findByPrimaryIndex("hash", bundle.hash))?.value
    );

    return { ctx, transactionHash: txHash, bundleHash: bundle.hash };
  },
  {
    name: "ProcessNewBundleProcessEngine",
  }
);

const formatBundle = async (rawBundle: RawBundle): Promise<Bundle> => {
  // const rawUtxos = [...rawBundle.create, ...rawBundle.spend];

  const bundlBufferPreHash = POOL.buildBundlePayload(
    convertRawBundleToBuffer(rawBundle)
  );
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
