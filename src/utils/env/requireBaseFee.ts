import type { BaseFee } from "@colibri/core";
import { requireEnv } from "@/utils/env/loadEnv.ts";
export const requireBaseFee = (keyName: string): BaseFee => {
  const key = requireEnv(keyName);
  if (isNaN(Number(key)) || Number(key) < 0) {
    throw new Error(`Invalid BaseFee '${key}' for ${keyName}`);
  }
  return key as BaseFee;
};
