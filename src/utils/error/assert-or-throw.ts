export function assertOrThrow<T>(
  condition: T | unknown,
  error: Error,
): asserts condition {
  if (!condition) {
    throw error;
  }
}
