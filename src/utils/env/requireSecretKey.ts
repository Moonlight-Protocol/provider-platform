import { type Ed25519SecretKey, StrKey } from "@colibri/core";
import { requireEnv } from "@/utils/env/loadEnv.ts";

export const requireSecretKey = (keyName: string): Ed25519SecretKey => {
  const key = requireEnv(keyName);
  if (StrKey.isValidEd25519SecretSeed(key) === false) {
    throw new Error(`Invalid Stellar secret key for ${keyName}`);
  }

  return key as Ed25519SecretKey;
};
