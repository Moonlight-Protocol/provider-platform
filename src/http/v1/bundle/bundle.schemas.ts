import { z } from "zod";

export const bundleRequestSchema = (max: number) =>
  z.object({
    operationsMLXDR: z.array(z.string()).min(1).max(max),
    channelContractId: z.string().min(1),
  });
