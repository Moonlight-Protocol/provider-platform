import { MetadataHelper, Transformer } from "@fifo/convee";
import { ErrorResponse } from "../default-schemas.ts";
import { Status } from "@oak/oak";

type Input = Error;
type Output = ErrorResponse;

export const ERROR_TO_API_RESPONSE: Transformer<Input, Output> = async (
  error: Error,
  _metadataHelper?: MetadataHelper,
): Promise<Output> => {
  const status = Status.InternalServerError;

  return {
    status,
    message: error.message,
    data: { error: error.message },
  };
};
