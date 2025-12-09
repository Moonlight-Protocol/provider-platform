import { ProcessEngine, type MetadataHelper } from "@fifo/convee";
import type { ErrorResponse } from "@/http/default-schemas.ts";
import { PlatformError } from "@/error/index.ts";

const PROCESS_NAME = "ErrorToApiResponse" as const;

export const P_ErrorToApiResponse = () => {
  const errorToApiResponse = (
    error: Error | PlatformError<unknown>,
    _metadataHelper?: MetadataHelper
  ): ErrorResponse => {
    if (PlatformError.is(error)) {
      return error.getAPIError();
    }

    return PlatformError.fromUnknown(error).getAPIError();
  };

  return ProcessEngine.create<Error, ErrorResponse, Error, typeof PROCESS_NAME>(
    errorToApiResponse,
    {
      name: PROCESS_NAME,
    }
  );
};
