import { PlatformError } from "@/error/index.ts";

export enum HTTP_AUTH_ERROR_CODES {
  MISSING_AUTHORIZATION_HEADER = "HTTP_AUTH_001",
  INVALID_AUTHORIZATION_HEADER = "HTTP_AUTH_002",
  EXPIRED_TOKEN = "HTTP_AUTH_003",
  JWT_VERIFICATION_FAILED = "HTTP_AUTH_004",
}

const source = "@http/middleware/auth";

export class MISSING_AUTHORIZATION_HEADER extends PlatformError {
  constructor() {
    super({
      source,
      code: HTTP_AUTH_ERROR_CODES.MISSING_AUTHORIZATION_HEADER,
      message: "Missing authorization header",
      details: "The authorization header is missing from the HTTP request.",
      api: {
        status: 401,
        message: "Missing authorization header",
        details:
          "The HTTP request did not include the required authorization header.",
      },
    });
  }
}

export class INVALID_AUTHORIZATION_HEADER extends PlatformError {
  constructor() {
    super({
      source,
      code: HTTP_AUTH_ERROR_CODES.INVALID_AUTHORIZATION_HEADER,
      message: "Invalid authorization header",
      details:
        "The authorization header provided in the HTTP request is invalid.",
      api: {
        status: 401,
        message: "Invalid authorization header",
        details:
          "The HTTP request included an invalid authorization header. It must be formatted as 'Bearer <token>'.",
      },
    });
  }
}

export class EXPIRED_TOKEN extends PlatformError {
  constructor() {
    super({
      source,
      code: HTTP_AUTH_ERROR_CODES.EXPIRED_TOKEN,
      message: "Expired token",
      details: "The provided authentication token has expired.",
      api: {
        status: 401,
        message: "Expired token",
        details:
          "The authentication token provided in the request has expired and is no longer valid.",
      },
    });
  }
}

export class JWT_VERIFICATION_FAILED extends PlatformError {
  constructor(error: Error | unknown) {
    super({
      source,
      code: HTTP_AUTH_ERROR_CODES.JWT_VERIFICATION_FAILED,
      message: "JWT verification failed",
      details: "The provided JWT token could not be verified.",
      baseError: error,
      api: {
        status: 401,
        message: "JWT verification failed",
        details:
          "The JWT token provided in the request could not be verified. It may be malformed or tampered with.",
      },
    });
  }
}
