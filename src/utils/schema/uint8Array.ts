import { z } from "zod";

export const uint8ArraySchema = z.preprocess((data) => {
  if (Array.isArray(data)) {
    return new Uint8Array(data);
  }
  return data;
}, z.instanceof(Uint8Array, { message: "Must be a Uint8Array" }));

export type Uint8ArraySchema = z.infer<typeof uint8ArraySchema>;
