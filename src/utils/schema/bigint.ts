import { z } from "npm:zod@3.24.2";

export const bigintSchema = z.preprocess(
  (data) => (typeof data === "string" ? BigInt(data) : data),
  z.bigint()
);
