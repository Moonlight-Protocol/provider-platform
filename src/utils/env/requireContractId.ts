import { type ContractId, StrKey } from "@colibri/core";
import { requireEnv } from "@/utils/env/loadEnv.ts";

export const requireContractId = (keyName: string): ContractId => {
  const key = requireEnv(keyName);
  if (StrKey.isValidContractId(key) === false) {
    throw new Error(`Invalid Stellar contract ID for ${keyName}`);
  }

  return key as ContractId;
};
