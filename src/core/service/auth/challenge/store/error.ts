import { PlatformError } from "@/error/index.ts";

export enum STORE_CHALLENGE_ERROR_CODES {
  FAILED_TO_STORE_CHALLENGE_IN_DATABASE = "ACH_ST_001",
  FAILED_TO_CACHE_CHALLENGE_IN_LIVE_SESSIONS = "ACH_ST_002",
  SESSION_ALREADY_EXISTS = "ACH_ST_003",
  CHALLENGE_NOT_FOUND_IN_DATABASE = "ACH_ST_004",
  CHALLENGE_HAS_NO_OPERATIONS = "ACH_ST_005",
  MISSING_CLIENT_ACCOUNT = "ACH_ST_006",
  USER_NOT_FOUND_IN_DATABASE = "ACH_ST_007",
}

const source = "@service/auth/challenge/store";

export class FAILED_TO_STORE_CHALLENGE_IN_DATABASE extends PlatformError {
  constructor(error: Error | unknown) {
    super({
      source,
      code: STORE_CHALLENGE_ERROR_CODES.FAILED_TO_STORE_CHALLENGE_IN_DATABASE,
      message: "Failed to store challenge in database",
      details:
        "An error occurred while attempting to store the authentication challenge in the database.",
      baseError: error,
      api: {
        status: 500,
        message: "Failed to store challenge in database",
        details:
          "An unexpected error occurred while saving the authentication challenge to the database.",
      },
    });
  }
}

export class FAILED_TO_CACHE_CHALLENGE_IN_LIVE_SESSIONS extends PlatformError {
  constructor(error: Error | unknown) {
    super({
      source,
      code:
        STORE_CHALLENGE_ERROR_CODES.FAILED_TO_CACHE_CHALLENGE_IN_LIVE_SESSIONS,
      message: "Failed to cache challenge in live sessions",
      details:
        "An error occurred while attempting to cache the authentication challenge in live sessions.",
      baseError: error,
      api: {
        status: 500,
        message: "Failed to cache challenge in live sessions",
        details:
          "An unexpected error occurred while caching the authentication challenge in live sessions.",
      },
    });
  }
}
export class SESSION_ALREADY_EXISTS extends PlatformError {
  constructor(sessionId: string) {
    super({
      source,
      code: STORE_CHALLENGE_ERROR_CODES.SESSION_ALREADY_EXISTS,
      message: "Session already exists",
      details: "An authentication session with the provided ID already exists.",
      api: {
        status: 409,
        message: "Session already exists",
        details:
          `An authentication session with ID '${sessionId}' already exists in live sessions.`,
      },
      meta: {
        sessionId,
      },
    });
  }
}

export class CHALLENGE_NOT_FOUND_IN_DATABASE extends PlatformError {
  constructor(challengeId: string) {
    super({
      source,
      code: STORE_CHALLENGE_ERROR_CODES.CHALLENGE_NOT_FOUND_IN_DATABASE,
      message: "Challenge not found in database",
      details:
        "The requested authentication challenge could not be found in the database.",
      api: {
        status: 404,
        message: "Challenge not found",
        details:
          `The authentication challenge with ID '${challengeId}' was not found in the database.`,
      },
      meta: {
        challengeId,
      },
    });
  }
}

export class CHALLENGE_HAS_NO_OPERATIONS extends PlatformError {
  constructor(sessionId: string) {
    super({
      source,
      code: STORE_CHALLENGE_ERROR_CODES.CHALLENGE_HAS_NO_OPERATIONS,
      message: "Challenge has no operations",
      details:
        "The authentication challenge does not contain any operations to process.",
      api: {
        status: 400,
        message: "Challenge has no operations",
        details:
          `The authentication session with ID '${sessionId}' has a challenge that does not contain any operations.`,
      },
      meta: {
        sessionId,
      },
    });
  }
}

export class MISSING_CLIENT_ACCOUNT extends PlatformError {
  constructor() {
    super({
      source,
      code: STORE_CHALLENGE_ERROR_CODES.MISSING_CLIENT_ACCOUNT,
      message: "Missing client account",
      details:
        "The client account is missing from the authentication challenge session.",
      api: {
        status: 400,
        message: "Missing client account",
        details:
          "The authentication challenge session did not include the required client account.",
      },
    });
  }
}

export class USER_NOT_FOUND_IN_DATABASE extends PlatformError {
  constructor(clientAccount: string) {
    super({
      source,
      code: STORE_CHALLENGE_ERROR_CODES.USER_NOT_FOUND_IN_DATABASE,
      message: "User not found in database",
      details:
        "The user associated with the provided client account could not be found in the database.",
      api: {
        status: 404,
        message: "User not found",
        details:
          `The user with client account '${clientAccount}' was not found in the database.`,
      },
      meta: {
        clientAccount,
      },
    });
  }
}
