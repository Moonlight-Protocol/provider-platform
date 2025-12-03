import z from "zod";

export const UtxoStatus = z.enum(["unspent", "spent", "free"]);

export const utxoSchema = z.object({
  publicKey: z.string(),
  status: UtxoStatus,
  amount: z.bigint().optional(),
});

export type UTXO = z.infer<typeof utxoSchema>;
