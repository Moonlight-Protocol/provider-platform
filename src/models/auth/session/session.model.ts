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
