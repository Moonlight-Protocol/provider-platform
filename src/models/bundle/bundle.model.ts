import { z } from "npm:zod@3.24.2";
import { collection } from "jsr:@olli/kvdex@^3.1.4";
import { dateSchema } from "../../utils/schema/date.ts";

export type BundleModel = z.infer<typeof bundleModel>;

export const bundleModel = z.object({
  createdAt: dateSchema,
  updatedAt: dateSchema,
  hash: z.string(),
  status: z.enum(["pending", "confirmed", "failed"]),
  feeCharged: z.string(),
  clientAccount: z.string(),
  txHash: z.string(),
});

export const bundleCollection = collection(bundleModel, {
  // history: true,
  // encoder: jsonEncoder(),
  idGenerator: (b) => b.hash,
  indices: {
    hash: "primary",
    status: "secondary",
    // clientAccount: "tertiary",
  },
});
