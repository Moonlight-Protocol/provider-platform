import { collection } from "@olli/kvdex";
import { z } from "zod";

const sessionStatusEnum = z.enum(["PENDING", "ACTIVE"]);

const sessionEntity = z.object({
  txHash: z.string(),
  clientAccount: z.string(),
  expiresAt: z.date(),
  status: sessionStatusEnum,
  requestId: z.string(),
});

export type SessionStatus = typeof sessionStatusEnum;
export type Session = z.infer<typeof sessionEntity>;

export const sessionCollection = collection(sessionEntity, {
  idGenerator: (session) => session.txHash,
  indices: {
    txHash: "primary",
    clientAccount: "secondary",
    expiresAt: "secondary",
    status: "secondary",
  },
});
