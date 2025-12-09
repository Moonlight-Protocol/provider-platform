import { PlatformError } from "@/error/index.ts";

export enum HTTP_RATE_LIMIT_ERROR_CODES {
  EXCEEDED_LIMIT = "HTTP_RATE_LIMIT_001",
  FAILED_TO_DETECT_IP = "HTTP_RATE_LIMIT_002",
}

const source = "@http/middleware/rate-limit";

export class EXCEEDED_LIMIT extends PlatformError {
  constructor() {
    super({
      source,
      code: HTTP_RATE_LIMIT_ERROR_CODES.EXCEEDED_LIMIT,
      message: "Rate limit exceeded",
      details: "The rate limit has been exceeded for the HTTP request.",
      api: {
        status: 429,
        message: "Rate limit exceeded",
      },
    });
  }
}

export class FAILED_TO_DETECT_IP extends PlatformError {
  constructor(error: Error | unknown) {
    super({
      source,
      code: HTTP_RATE_LIMIT_ERROR_CODES.FAILED_TO_DETECT_IP,
      message: "Failed to detect client IP",
      details: "An error occurred while attempting to detect the client IP.",
      baseError: error,
      api: {
        status: 500,
        message: "Failed to detect client IP",
        details:
          "An unexpected error occurred while trying to determine the client's IP address for rate limiting.",
      },
    });
  }
}
