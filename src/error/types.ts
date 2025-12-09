import type { ErrorResponse } from "@/http/default-schemas.ts";

export type PlatformErrorShape<M> = {
  code: string; // ex: "CC_001"
  message: string;
  source: string; // ex: "@http/processes/"
  details?: string;
  meta?: M;
  baseError?: Error | unknown; // The underlying cause of the error
  api?: APIDetails;
};

export type ApiError = ErrorResponse;
export type APIDetails = Omit<ApiError, "code">;
