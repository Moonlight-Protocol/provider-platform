import { z } from "zod";
import { collection } from "@olli/kvdex";
import { jsonEncoder } from "@olli/kvdex/encoding/json";

export type Challenge = z.infer<typeof challengeModel>;

//   dateCreated: timestamp().notNull(),
//     dateUpdated: timestamp().notNull(),
//     expiresAt: timestamp().notNull(),
//     txHash: text().primaryKey().notNull(),
//     clientAccount: text().notNull(),
//     xdr: text().notNull(),
//     nonce: text().notNull(),
//     clientIp: text().notNull(),
//     userAgent: text().notNull(),
//     signedXdr: text(),
//     requestId: text().notNull(),
export const challengeModel = z.object({
  dateCreated: z.date(),
  dateUpdated: z.date(),
  expiresAt: z.date(),
  txHash: z.string(),
  clientAccount: z.string(),
  xdr: z.string(),
  nonce: z.string(),
  clientIp: z.string(),
  userAgent: z.string(),
  requestId: z.string(),
  signedXdr: z.string().optional(),
});

export const challengeCollection = collection(challengeModel, {
  history: true,
  encoder: jsonEncoder(),

  idGenerator: (challenge) => challenge.txHash,

  indices: {
    txHash: "primary", // unique
    clientAccount: "secondary", // non-unique
    expiresAt: "secondary", // non-unique
  },
});
