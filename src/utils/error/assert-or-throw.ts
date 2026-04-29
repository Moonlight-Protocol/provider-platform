import { logAndThrow } from "@/utils/error/log-and-throw.ts";

export function assertOrThrow<T>(
  condition: T | unknown,
  error: Error,
): asserts condition {
  if (!condition) {
    logAndThrow(error);
  }
}
