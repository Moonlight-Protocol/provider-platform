import { ProcessEngine, type MetadataHelper } from "@fifo/convee";
import type { ErrorResponse } from "@/http/default-schemas.ts";
import { Status } from "@oak/oak";

const PROCESS_NAME = "ErrorToApiResponse" as const;

export const P_ErrorToApiResponse = () => {
  const errorToApiResponse = (
    error: Error,
    _metadataHelper?: MetadataHelper
  ): ErrorResponse => {
    const status = Status.InternalServerError;

    return {
      status,
      message: error.message,
      data: { error: error.message },
    };
  };

  return ProcessEngine.create<Error, ErrorResponse, Error, typeof PROCESS_NAME>(
    errorToApiResponse,
    {
      name: PROCESS_NAME,
    }
  );
};
