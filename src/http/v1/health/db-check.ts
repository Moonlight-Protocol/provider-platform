/**
 * Bounded database connectivity probe for the /health endpoint.
 *
 * Intentionally dependency-free so it can be unit-tested without a live
 * database or a `DATABASE_URL` in the environment — the caller injects the
 * actual query.
 */

/** Upper bound on how long the /health DB probe may run, in milliseconds. */
// Kept well under the Fly http_service check `timeout` (3s) so a slow or
// unreachable DB resolves to a fast 503 instead of hanging the health check.
export const DB_HEALTH_TIMEOUT_MS = 2000;

/**
 * Run a bounded connectivity probe and report DB health.
 *
 * Resolves to `"ok"` if `probe` settles successfully within `timeoutMs`,
 * otherwise `"error"` — covering both a genuine connection failure (probe
 * rejects) and an unresponsive DB (timeout). Never throws.
 *
 * A `SELECT 1` only checks that a connection can be established; it does not
 * depend on any migrated schema. So a fresh boot whose migrations are still
 * pending still reports `"ok"` as long as Postgres is reachable, which keeps
 * the Fly deploy health-gate from flapping during the startup window. Only a
 * genuine unreachable/unresponsive DB reports `"error"`.
 */
export async function checkDbHealth(
  probe: () => Promise<unknown>,
  timeoutMs: number = DB_HEALTH_TIMEOUT_MS,
): Promise<"ok" | "error"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      probe(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("db health probe timed out")),
          timeoutMs,
        );
      }),
    ]);
    return "ok";
  } catch {
    return "error";
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
