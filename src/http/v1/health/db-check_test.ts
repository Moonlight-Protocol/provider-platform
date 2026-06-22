import { assertEquals } from "@std/assert";
import { checkDbHealth } from "@/http/v1/health/db-check.ts";

Deno.test("checkDbHealth: ok when probe resolves", async () => {
  const result = await checkDbHealth(() =>
    Promise.resolve([{ "?column?": 1 }])
  );
  assertEquals(result, "ok");
});

Deno.test("checkDbHealth: error when probe rejects (connection failure)", async () => {
  const result = await checkDbHealth(() =>
    Promise.reject(new Error("ECONNREFUSED"))
  );
  assertEquals(result, "error");
});

Deno.test("checkDbHealth: error when probe exceeds the timeout", async () => {
  let pending: ReturnType<typeof setTimeout> | undefined;
  const start = performance.now();
  const result = await checkDbHealth(
    // Never settles on its own — the timeout must win.
    () =>
      new Promise(() => {
        pending = setTimeout(() => {}, 60_000);
      }),
    20,
  );
  const elapsed = performance.now() - start;
  if (pending !== undefined) clearTimeout(pending);

  assertEquals(result, "error");
  // The bound must actually fire promptly rather than waiting on the probe.
  assertEquals(elapsed < 1_000, true);
});
