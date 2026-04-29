import { z } from "zod";
import { collection } from "@olli/kvdex";

export type User = z.infer<typeof userModel>;

export const userModel = z.object({
  dateCreated: z.date(),
  dateUpdated: z.date(),
  publicKey: z.string(),
});

export const userCollection = collection(userModel, {
  idGenerator: (user) => user.publicKey,
  indices: {
    publicKey: "primary",
  },
});
