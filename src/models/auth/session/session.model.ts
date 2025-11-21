import { collection } from "@olli/kvdex";
import { z } from "zod";

const sessionStatusModel = z.enum(["PENDING", "ACTIVE"]);

const sessionModel = z.object({
  txHash: z.string(),
  clientAccount: z.string(),
  expiresAt: z.date(),
  status: sessionStatusModel,
  requestId: z.string(),
});

export type SessionStatus = z.infer<typeof sessionStatusModel>;
export type Session = z.infer<typeof sessionModel>;

export const sessionCollection = collection(sessionModel, {
  idGenerator: (session) => session.txHash,
  indices: {
    txHash: "primary",
    clientAccount: "secondary",
    expiresAt: "secondary",
    status: "secondary",
  },
});
