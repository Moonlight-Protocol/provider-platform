import { PlatformError } from "@/error/index.ts";

export enum CREATE_CHALLENGE_ERROR_CODES {
  MISSING_CLIENT_ACCOUNT = "ACH_CR_001",
  FAILED_TO_CREATE_CHALLENGE = "ACH_CR_002",
  INVALID_SIGNED_TRANSACTION_OBJ = "ACH_CR_003",
}

const source = "@service/auth/challenge/create";

export class MISSING_CLIENT_ACCOUNT extends PlatformError {
  constructor() {
    super({
      source,
      code: CREATE_CHALLENGE_ERROR_CODES.MISSING_CLIENT_ACCOUNT,
      message: "Missing client account in challenge request",
      details:
        "The client account is missing from the authentication challenge request.",
      api: {
        status: 400,
        message: "Missing client account",
        details:
          "The authentication challenge request did not include the required client account.",
      },
    });
  }
}

export class FAILED_TO_CREATE_CHALLENGE extends PlatformError {
  constructor(error: Error | unknown) {
    super({
      source,
      code: CREATE_CHALLENGE_ERROR_CODES.FAILED_TO_CREATE_CHALLENGE,
      message: "Failed to create authentication challenge",
      details:
        "An error occurred while attempting to create the authentication challenge.",
      baseError: error,
      api: {
        status: 500,
        message: "Failed to create authentication challenge",
        details:
          "An unexpected error occurred during the creation of the authentication challenge.",
      },
    });
  }
}

export class INVALID_SIGNED_TRANSACTION_OBJ extends PlatformError {
  constructor(tx: unknown) {
    super({
      source,
      code: CREATE_CHALLENGE_ERROR_CODES.INVALID_SIGNED_TRANSACTION_OBJ,
      message: "Invalid signed transaction object",
      details:
        "The signed transaction object provided in the challenge request is invalid.",
      api: {
        status: 400,
        message: "Invalid signed transaction object",
        details:
          "The signed transaction object included in the authentication challenge request is not valid.",
      },
      meta: {
        signedTransaction: tx,
      },
    });
  }
}
