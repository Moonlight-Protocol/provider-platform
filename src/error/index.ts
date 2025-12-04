import { isError } from "@/utils/type-guards/is-error.ts";
import type {
  APIDetails,
  ApiError,
  PlatformErrorShape,
} from "@/error/types.ts";
import { isDefined } from "../utils/type-guards/is-defined.ts";

export enum GENERAL_ERROR_CODES {
  UNEXPECTED = "GEN_000",
  UNKNOWN = "GEN_001",
}

export class PlatformError<M = undefined | unknown> extends Error {
  readonly code: string;
  readonly source: string;
  readonly details?: string;
  readonly meta?: M;
  readonly baseError?: Error | unknown;
  readonly api?: APIDetails;

  constructor(e: PlatformErrorShape<M>) {
    super(e.message);
    this.name = "ML Platform Error: " + e.code;
    this.code = e.code;
    this.source = e.source;
    this.details = e.details;
    this.meta = e.meta;
    this.baseError = e.baseError;
    this.api = e.api;
  }

  static is<M>(e: unknown): e is PlatformError<M> {
    return e instanceof PlatformError;
  }

  static unexpected(
    args?: Partial<PlatformErrorShape<unknown>>
  ): PlatformError<unknown> {
    return new PlatformError<unknown>({
      source: args?.source ?? "@general/unexpected",
      code: (args?.code ?? GENERAL_ERROR_CODES.UNEXPECTED) as string,
      message: args?.message ?? "Unexpected error",
      details: args?.details ?? "An unexpected error occurred",
      meta: args?.meta,
      baseError: args?.baseError,
      api: args?.api,
    });
  }

  static fromUnknown(
    error: unknown,
    ctx?: Partial<PlatformErrorShape<unknown>>
  ): PlatformError<unknown> {
    if (error instanceof PlatformError) return error;
    if (error instanceof Error) {
      return new PlatformError({
        source: ctx?.source ?? "@general/unknown",
        code: ctx?.code ?? GENERAL_ERROR_CODES.UNKNOWN,
        message: error.message,
        details: ctx?.details ?? error.stack,
        meta: ctx?.meta,
        baseError: error,
        api: ctx?.api,
      });
    }
    return PlatformError.unexpected({ baseError: error, ...ctx });
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      source: this.source,
      details: this.details,
      meta: this.meta,
      baseError: isError(this.baseError)
        ? { baseError: this.baseError.message }
        : this.baseError,
      api: this.api,
    };
  }

  hasAPIError(): this is PlatformError<M> & { api: ApiError } {
    return isDefined(this.api);
  }

  getAPIError(): ApiError {
    if (this.hasAPIError()) return this.api;
    return {
      code: this.code,
      status: 500,
      message: "Internal server error.",
      details: "Contact your provider and share the details of this error.",
    };
  }
}
