/** Raised when {@link withTimeout} elapses before its promise settles. */
export class TimeoutError extends Error {
  constructor(readonly opName: string, readonly ms: number) {
    super(`${opName} timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * Race a promise against a deadline so a hung dependency (e.g. an unreachable
 * Soroban RPC during bundle admission) fast-fails instead of blocking the
 * request indefinitely (#2). The underlying promise is not cancelled — it is
 * abandoned — so only use this for idempotent reads.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  opName: string,
): Promise<T> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new TimeoutError(opName, ms)),
      ms,
    ) as unknown as number;
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
