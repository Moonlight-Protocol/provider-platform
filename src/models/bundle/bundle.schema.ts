import { Buffer } from "buffer";
import { z } from "zod";
import { uint8ArraySchema } from "@/utils/schema/uint8Array.ts";
import { bigintSchema } from "@/utils/schema/bigint.ts";
import { utxoSchema } from "@/models/utxo/utxo.schema.ts";

export const rawBundleSchema = z.object({
  create: z.array(z.tuple([uint8ArraySchema, bigintSchema]).readonly()),
  signatures: z.array(uint8ArraySchema),
  spend: z.array(uint8ArraySchema),
});

export type RawBundle = z.infer<typeof rawBundleSchema>;

export type BundleBuffer = {
  create: Array<readonly [Buffer, bigint]>;
  signatures: Array<Buffer>;
  spend: Array<Buffer>;
};

export const bundleSchema = z.object({
  hash: z.string(),
  create: z.array(utxoSchema),
  spend: z.array(utxoSchema),
});

export type Bundle = z.infer<typeof bundleSchema>;

export function convertRawBundleToBuffer(raw: RawBundle): BundleBuffer {
  return {
    create: raw.create.map(([u8, bn]) => [Buffer.from(u8), bn]),
    signatures: raw.signatures.map((u8) => Buffer.from(u8)),
    spend: raw.spend.map((u8) => Buffer.from(u8)),
  };
}
