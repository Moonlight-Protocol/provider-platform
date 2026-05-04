import { z } from "zod";

export const bigintSchema = z.preprocess(
  (data) => (typeof data === "string" ? BigInt(data) : data),
  z.bigint(),
);
