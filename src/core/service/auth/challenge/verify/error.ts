import { PlatformError } from "@/error/index.ts";
import type { Transaction } from "stellar-sdk";

export enum VERIFY_CHALLENGE_ERROR_CODES {
  CHALLENGE_IS_NOT_TRANSACTION = "ACH_VR_001",
  CHALLENGE_NOT_FOUND = "AUTH_VR_002",
  NONCE_MISMATCH = "AUTH_VR_003",
  CLIENT_ACCOUNT_MISMATCH = "AUTH_VR_004",
  CHALLENGE_TTL_MISMATCH = "AUTH_VR_005",
  MISSING_NONCE_OPERATION = "AUTH_VR_006",
  WRONG_OPERATION_TYPE = "AUTH_VR_007",
  MISSING_CLIENT_ACCOUNT = "AUTH_VR_008",
  MISSING_NONCE = "AUTH_VR_009",
  INVALID_SEQUENCE_NUMBER = "AUTH_VR_010",
  MISSING_TIME_BOUNDS = "AUTH_VR_011",
  MISSING_OPERATIONS = "AUTH_VR_012",
  OPERATION_KEY_MISMATCH = "AUTH_VR_013",
  CHALLENGE_TOO_EARLY = "AUTH_VR_014",
  CHALLENGE_EXPIRED = "AUTH_VR_015",
  MISSING_SERVER_SIGNATURE = "AUTH_VR_016",
  MISSING_CLIENT_SIGNATURE = "AUTH_VR_017",
  CHALLENGE_VERIFICATION_FAILED = "AUTH_VR_018",
}

const source = "@service/auth/challenge/verify";

export class CHALLENGE_IS_NOT_TRANSACTION extends PlatformError {
  constructor(tx: unknown) {
    super({
      source,
      code: VERIFY_CHALLENGE_ERROR_CODES.CHALLENGE_IS_NOT_TRANSACTION,
      message: "Challenge is not a transaction",
      details:
        "The provided authentication challenge is not a valid Stellar transaction.",
      api: {
        status: 400,
        message: "Challenge is not a transaction",
        details:
          "The authentication challenge provided could not be parsed as a Stellar transaction.",
      },
      meta: {
        challenge: tx,
      },
    });
  }
}

export class CHALLENGE_NOT_FOUND extends PlatformError {
  constructor(challengeId: string) {
    super({
      source,
      code: VERIFY_CHALLENGE_ERROR_CODES.CHALLENGE_NOT_FOUND,
      message: "Authentication challenge not found",
      details:
        `The authentication challenge with ID '${challengeId}' was not found.`,
      api: {
        status: 404,
        message: "Authentication challenge not found",
        details:
          `No authentication challenge exists with the provided ID '${challengeId}'.`,
      },
      meta: {
        challengeId,
      },
    });
  }
}

export class NONCE_MISMATCH extends PlatformError {
  constructor(expectedNonce: string, providedNonce: string) {
    super({
      source,
      code: VERIFY_CHALLENGE_ERROR_CODES.NONCE_MISMATCH,
      message: "Nonce mismatch",
      details:
        "The provided nonce does not match the expected nonce for the authentication challenge.",
      api: {
        status: 400,
        message: "Nonce mismatch",
        details:
          "The nonce provided in the authentication challenge response does not match the expected value.",
      },
      meta: {
        expectedNonce,
        providedNonce,
      },
    });
  }
}

export class CLIENT_ACCOUNT_MISMATCH extends PlatformError {
  constructor(expectedAccount: string, providedAccount: string) {
    super({
      source,
      code: VERIFY_CHALLENGE_ERROR_CODES.CLIENT_ACCOUNT_MISMATCH,
      message: "Client account mismatch",
      details:
        "The provided client account does not match the expected account for the authentication challenge.",
      api: {
        status: 400,
        message: "Client account mismatch",
        details:
          "The client account provided in the authentication challenge response does not match the expected account.",
      },
      meta: {
        expectedAccount,
        providedAccount,
      },
    });
  }
}

export class CHALLENGE_TTL_MISMATCH extends PlatformError {
  constructor(expectedTtl: Date, providedTtl: Date) {
    super({
      source,
      code: VERIFY_CHALLENGE_ERROR_CODES.CHALLENGE_TTL_MISMATCH,
      message: "Challenge TTL mismatch",
      details:
        "The provided challenge TTL does not match the expected TTL for the authentication challenge.",
      api: {
        status: 400,
        message: "Challenge TTL mismatch",
        details:
          "The TTL provided in the authentication challenge response does not match the expected value.",
      },
      meta: {
        expectedTtl,
        providedTtl,
      },
    });
  }
}

export class MISSING_NONCE_OPERATION extends PlatformError {
  constructor(tx: Transaction) {
    super({
      source,
      code: VERIFY_CHALLENGE_ERROR_CODES.MISSING_NONCE_OPERATION,
      message: "Missing nonce operation",
      details:
        "The authentication challenge is missing the required nonce operation.",
      api: {
        status: 500,
        message: "Missing nonce operation",
        details:
          "The authentication challenge does not include the necessary nonce operation for validation.",
      },
      meta: {
        transaction: tx,
      },
    });
  }
}

export class WRONG_OPERATION_TYPE extends PlatformError {
  constructor(expectedType: string, actualType: string) {
    super({
      source,
      code: VERIFY_CHALLENGE_ERROR_CODES.WRONG_OPERATION_TYPE,
      message: "Wrong operation type",
      details:
        "The operation type in the authentication challenge does not match the expected type.",
      api: {
        status: 500,
        message: "Wrong operation type",
        details:
          `The operation type '${actualType}' does not match the expected type '${expectedType}' for the authentication challenge.`,
      },
      meta: {
        expectedType,
        actualType,
      },
    });
  }
}

export class MISSING_CLIENT_ACCOUNT extends PlatformError {
  constructor() {
    super({
      source,
      code: VERIFY_CHALLENGE_ERROR_CODES.MISSING_CLIENT_ACCOUNT,
      message: "Missing client account",
      details:
        "The client account is missing from the authentication challenge operation.",
      api: {
        status: 500,
        message: "Missing client account",
        details:
          "The authentication challenge operation does not specify the client account.",
      },
    });
  }
}

export class MISSING_NONCE extends PlatformError {
  constructor() {
    super({
      source,
      code: VERIFY_CHALLENGE_ERROR_CODES.MISSING_NONCE,
      message: "Missing nonce",
      details:
        "The nonce is missing from the authentication challenge operation.",
      api: {
        status: 500,
        message: "Missing nonce",
        details:
          "The authentication challenge operation does not include the required nonce value.",
      },
    });
  }
}

export class INVALID_SEQUENCE_NUMBER extends PlatformError {
  constructor(sequence: string) {
    super({
      source,
      code: VERIFY_CHALLENGE_ERROR_CODES.INVALID_SEQUENCE_NUMBER,
      message: "Invalid sequence number",
      details:
        `The sequence number '${sequence}' of the authentication challenge transaction is invalid.`,
      api: {
        status: 400,
        message: "Invalid sequence number",
        details:
          `The sequence number of the provided authentication challenge transaction must be '0'. The received sequence number was '${sequence}'.`,
      },
      meta: {
        sequence,
      },
    });
  }
}

export class MISSING_TIME_BOUNDS extends PlatformError {
  constructor() {
    super({
      source,
      code: VERIFY_CHALLENGE_ERROR_CODES.MISSING_TIME_BOUNDS,
      message: "Missing time bounds",
      details:
        "The authentication challenge transaction is missing the required time bounds.",
      api: {
        status: 400,
        message: "Missing time bounds",
        details:
          "The provided authentication challenge transaction does not include time bounds, which are required for validation.",
      },
    });
  }
}

export class MISSING_OPERATIONS extends PlatformError {
  constructor(tx: Transaction) {
    super({
      source,
      code: VERIFY_CHALLENGE_ERROR_CODES.MISSING_OPERATIONS,
      message: "Missing operations",
      details:
        "The authentication challenge transaction does not contain any operations.",
      api: {
        status: 400,
        message: "Missing operations",
        details:
          "The provided authentication challenge transaction must include at least one operation for validation.",
      },
      meta: {
        transaction: tx,
      },
    });
  }
}

export class OPERATION_KEY_MISMATCH extends PlatformError {
  constructor(expectedKey: string, actualKey: string) {
    super({
      source,
      code: VERIFY_CHALLENGE_ERROR_CODES.OPERATION_KEY_MISMATCH,
      message: "Operation key mismatch",
      details:
        "The operation key in the authentication challenge does not match the expected key.",
      api: {
        status: 400,
        message: "Operation key mismatch",
        details:
          `The operation key '${actualKey}' does not match the expected key '${expectedKey}' for the authentication challenge.`,
      },
      meta: {
        expectedKey,
        actualKey,
      },
    });
  }
}

export class CHALLENGE_TOO_EARLY extends PlatformError {
  constructor(currentTime: number, minTime: number) {
    super({
      source,
      code: VERIFY_CHALLENGE_ERROR_CODES.CHALLENGE_TOO_EARLY,
      message: "Challenge too early",
      details:
        "The authentication challenge transaction's time bounds indicate it is not yet valid.",
      api: {
        status: 400,
        message: "Challenge too early",
        details:
          `The authentication challenge transaction cannot be used before its minimum time of ${minTime}. Current time is ${currentTime}.`,
      },
      meta: {
        currentTime,
        minTime,
      },
    });
  }
}

export class CHALLENGE_EXPIRED extends PlatformError {
  constructor(currentTime: number, maxTime: number) {
    super({
      source,
      code: VERIFY_CHALLENGE_ERROR_CODES.CHALLENGE_EXPIRED,
      message: "Challenge expired",
      details:
        "The authentication challenge transaction's time bounds indicate it has expired.",
      api: {
        status: 400,
        message: "Challenge expired",
        details:
          `The authentication challenge transaction expired at its maximum time of ${maxTime}. Current time is ${currentTime}.`,
      },
      meta: {
        currentTime,
        maxTime,
      },
    });
  }
}

export class MISSING_SERVER_SIGNATURE extends PlatformError {
  constructor() {
    super({
      source,
      code: VERIFY_CHALLENGE_ERROR_CODES.MISSING_SERVER_SIGNATURE,
      message: "Missing server signature",
      details:
        "The authentication challenge transaction is missing the required server signature.",
      api: {
        status: 400,
        message: "Missing server signature",
        details:
          "The provided authentication challenge transaction does not include the necessary server signature for validation.",
      },
    });
  }
}

export class MISSING_CLIENT_SIGNATURE extends PlatformError {
  constructor() {
    super({
      source,
      code: VERIFY_CHALLENGE_ERROR_CODES.MISSING_CLIENT_SIGNATURE,
      message: "Missing client signature",
      details:
        "The authentication challenge transaction is missing the required client signature.",
      api: {
        status: 400,
        message: "Missing client signature",
        details:
          "The provided authentication challenge transaction does not include the necessary client signature for validation.",
      },
    });
  }
}

export class CHALLENGE_VERIFICATION_FAILED extends PlatformError {
  constructor(error: Error | unknown) {
    super({
      source,
      code: VERIFY_CHALLENGE_ERROR_CODES.CHALLENGE_VERIFICATION_FAILED,
      message: "Challenge verification failed",
      details:
        "An error occurred during the verification of the authentication challenge.",
      api: {
        status: 500,
        message: "Challenge verification failed",
        details:
          "An unexpected error occurred while verifying the authentication challenge transaction.",
      },
      baseError: error,
    });
  }
}
