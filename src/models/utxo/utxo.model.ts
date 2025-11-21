import { z } from "zod";
import { collection } from "@olli/kvdex";
import { gAccountPublicKey } from "../../utils/regex/gAccountPublicKey.ts";
export type UTXOModel = z.infer<typeof utxoModel>;

export const utxoModel = z.object({
  createdAt: z.date(),
  updatedAt: z.date(),
  publicKey: z.string().regex(gAccountPublicKey),
  amount: z.number(),
  status: z.enum(["unspent", "spent"]),
  bundleCreateHash: z.string().optional(),
  bundleSpendHash: z.string().optional(),
});

export const utxoCollection = collection(utxoModel, {
  // history: true,
  // encoder: jsonEncoder(),
  idGenerator: (u) => u.publicKey,
  indices: {
    publicKey: "primary",
    status: "secondary",
    bundleCreateHash: "secondary",
    bundleSpendHash: "secondary",
  },
});
