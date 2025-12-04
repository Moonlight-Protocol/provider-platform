import { PlatformError } from "@/error/index.ts";

export enum CONFIG_ERROR_CODES {
  INVALID_NETWORK = "CFG_001",
}

export class INVALID_NETWORK extends PlatformError {
  constructor() {
    super({
      source: "@config",
      code: CONFIG_ERROR_CODES.INVALID_NETWORK,
      message: "Invalid network configuration",
      details:
        "The network configuration provided is invalid. Review the environment settings.",
    });
  }
}
