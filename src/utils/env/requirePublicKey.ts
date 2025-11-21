import { type Ed25519PublicKey, StrKey } from "@colibri/core";
import requireEnv from "./requireEnv.ts";

export const requirePublicKey = (keyName: string): Ed25519PublicKey => {
  const key = requireEnv(keyName);
  if (StrKey.isValidEd25519PublicKey(key) === false) {
    throw new Error(`Invalid Stellar public key for ${keyName}`);
  }

  return key as Ed25519PublicKey;
};
