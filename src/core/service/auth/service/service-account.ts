import { LocalSigner } from "@colibri/core";
import { PROVIDER_SK } from "@/config/env.ts";
export const PROVIDER_ACCOUNT = LocalSigner.fromSecret(PROVIDER_SK);
