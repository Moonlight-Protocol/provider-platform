import { PlatformError } from "@/error/index.ts";
import type { Transaction } from "stellar-sdk";

export enum SERVICE_AUTH_CHALLENGE_ERROR_CODES {
  CHALLENGE_NOT_FOUND = "AUTH_CH_001",
  MISSING_NONCE_OPERATION = "AUTH_CH_002",
  WRONG_OPERATION_TYPE = "AUTH_CH_003",
  MISSING_CLIENT_ACCOUNT = "AUTH_CH_004",
  MISSING_NONCE = "AUTH_CH_005",
  CHALLENGE_IS_NOT_TRANSACTION = "AUTH_CH_006",
  NONCE_MISMATCH = "AUTH_CH_007",
  CLIENT_ACCOUNT_MISMATCH = "AUTH_CH_008",
  CHALLENGE_TTL_MISMATCH = "AUTH_CH_009",
}

const source = "@service/auth/challenge";

export class CHALLENGE_NOT_FOUND extends PlatformError {
  constructor(challengeId: string) {
    super({
      source,
      code: SERVICE_AUTH_CHALLENGE_ERROR_CODES.CHALLENGE_NOT_FOUND,
      message: "Authentication challenge not found",
      details: `The authentication challenge with ID '${challengeId}' was not found.`,
      api: {
        status: 404,
        message: "Authentication challenge not found",
        details: `No authentication challenge exists with the provided ID '${challengeId}'.`,
      },
      meta: {
        challengeId,
      },
    });
  }
}

export class MISSING_NONCE_OPERATION extends PlatformError {
  constructor(tx: Transaction) {
    super({
      source,
      code: SERVICE_AUTH_CHALLENGE_ERROR_CODES.MISSING_NONCE_OPERATION,
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
      code: SERVICE_AUTH_CHALLENGE_ERROR_CODES.WRONG_OPERATION_TYPE,
      message: "Wrong operation type",
      details:
        "The operation type in the authentication challenge does not match the expected type.",
      api: {
        status: 500,
        message: "Wrong operation type",
        details: `The operation type '${actualType}' does not match the expected type '${expectedType}' for the authentication challenge.`,
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
      code: SERVICE_AUTH_CHALLENGE_ERROR_CODES.MISSING_CLIENT_ACCOUNT,
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
      code: SERVICE_AUTH_CHALLENGE_ERROR_CODES.MISSING_NONCE,
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

export class CHALLENGE_IS_NOT_TRANSACTION extends PlatformError {
  constructor(tx: unknown) {
    super({
      source,
      code: SERVICE_AUTH_CHALLENGE_ERROR_CODES.CHALLENGE_IS_NOT_TRANSACTION,
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

export class NONCE_MISMATCH extends PlatformError {
  constructor(expectedNonce: string, providedNonce: string) {
    super({
      source,
      code: SERVICE_AUTH_CHALLENGE_ERROR_CODES.NONCE_MISMATCH,
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
      code: SERVICE_AUTH_CHALLENGE_ERROR_CODES.CLIENT_ACCOUNT_MISMATCH,
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
      code: SERVICE_AUTH_CHALLENGE_ERROR_CODES.CHALLENGE_TTL_MISMATCH,
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
