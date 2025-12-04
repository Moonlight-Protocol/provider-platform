import { PlatformError } from "@/error/index.ts";
import type { ZodIssue } from "zod";

export enum HTTP_PROCESSES_ERROR_CODES {
  INVALID_PAYLOAD = "HTTP_PRO_001",
  FAILED_TO_PARSE_BODY = "HTTP_PRO_002",
  INVALID_QUERY_PARAMS = "HTTP_PRO_003",
  FAILED_TO_PARSE_QUERY_PARAMS = "HTTP_PRO_004",
  FAILED_TO_SET_SUCCESS_RESPONSE = "HTTP_PRO_005",
}

const source = "@http/processes";

export class INVALID_PAYLOAD extends PlatformError {
  constructor(error: Error | unknown, issues: ZodIssue[]) {
    super({
      source,
      code: HTTP_PROCESSES_ERROR_CODES.INVALID_PAYLOAD,
      message: "Invalid payload",
      details: "The payload provided in the HTTP request is invalid.",
      baseError: error,
      api: {
        status: 400,
        message: "Invalid payload",
        details: `The HTTP request payload did not conform to the expected format. \n ${issues
          .map((issue) => `- [${issue.path.join(".")}] ${issue.message}`)
          .join("\n")}`,
      },
      meta: {
        zodIssues: issues,
      },
    });
  }
}

export class FAILED_TO_PARSE_BODY extends PlatformError {
  constructor(error: Error | unknown) {
    super({
      source,
      code: HTTP_PROCESSES_ERROR_CODES.FAILED_TO_PARSE_BODY,
      message: "Failed to parse request body",
      details: "An error occurred while parsing the HTTP request body.",
      baseError: error,
      api: {
        status: 400,
        message: "Failed to parse request body",
        details: `The HTTP request body could not be parsed due to an unexpected error.`,
      },
    });
  }
}

export class INVALID_QUERY_PARAMS extends PlatformError {
  constructor(error: Error | unknown, issues: ZodIssue[]) {
    super({
      source,
      code: HTTP_PROCESSES_ERROR_CODES.INVALID_QUERY_PARAMS,
      message: "Invalid query parameters",
      details: "The query parameters provided in the HTTP request are invalid.",
      baseError: error,
      api: {
        status: 400,
        message: "Invalid query parameters",
        details: `The HTTP request query parameters did not conform to the expected format. \n ${issues
          .map((issue) => `- [${issue.path.join(".")}] ${issue.message}`)
          .join("\n")}`,
      },
      meta: {
        zodIssues: issues,
      },
    });
  }
}

export class FAILED_TO_PARSE_QUERY_PARAMS extends PlatformError {
  constructor(error: Error | unknown) {
    super({
      source,
      code: HTTP_PROCESSES_ERROR_CODES.FAILED_TO_PARSE_QUERY_PARAMS,
      message: "Failed to parse query parameters",
      details:
        "An error occurred while parsing the HTTP request query parameters.",
      baseError: error,
      api: {
        status: 400,
        message: "Failed to parse query parameters",
        details: `The HTTP request query parameters could not be parsed due to an unexpected error.`,
      },
    });
  }
}

export class FAILED_TO_SET_SUCCESS_RESPONSE extends PlatformError {
  constructor(error: Error | unknown) {
    super({
      source,
      code: HTTP_PROCESSES_ERROR_CODES.FAILED_TO_SET_SUCCESS_RESPONSE,
      message: "Failed to set success response",
      details: "An error occurred while setting the HTTP success response.",
      baseError: error,
      api: {
        status: 500,
        message: "Failed to set success response",
        details:
          "An unexpected error occurred while preparing the HTTP success response.",
      },
    });
  }
}
