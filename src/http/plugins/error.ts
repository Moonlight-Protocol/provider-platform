import { PlatformError } from "@/error/index.ts";

export enum HTTP_PLUGIN_ERROR_CODES {
  PROCESSING_ERROR_RESPONSE_FAILED = "HTTP_PLG_001",
}

export class PROCESSING_ERROR_RESPONSE_FAILED extends PlatformError {
  constructor(error: Error | unknown) {
    super({
      source: "@http/plugins/process-error-response",
      code: HTTP_PLUGIN_ERROR_CODES.PROCESSING_ERROR_RESPONSE_FAILED,
      message: "Failed to process error response",
      details:
        "An error occurred while processing the error response in the HTTP plugin.",
      baseError: error,
      api: {
        status: 500,
        message: "Failed to process error response",
        details:
          "An unexpected failure occurred while processing a captured error response.",
      },
    });
  }
}
