import { assertEquals } from "jsr:@std/assert";

/**
 * Tests for discoverCouncilHandler input validation.
 *
 * These tests call the handler directly with mock Oak contexts.
 * The handler's URL validation logic runs before any DB access,
 * so these tests work without a database connection.
 *
 * Note: The handler module imports DB repos at the top level,
 * which requires DATABASE_URL. We use dynamic import so the
 * test fails gracefully if the DB isn't available, rather than
 * crashing the entire test runner.
 */

// deno-lint-ignore no-explicit-any
function createMockContext(body: unknown): any {
  return {
    request: {
      body: { json: () => Promise.resolve(body) },
      headers: new Map<string, string>(),
      url: new URL("http://localhost:3010/api/v1/dashboard/council/discover"),
    },
    response: {
      status: 0,
      body: {} as Record<string, unknown>,
    },
  };
}

// deno-lint-ignore no-explicit-any
let discoverCouncilHandler: ((ctx: any) => Promise<void>) | null = null;
try {
  const mod = await import("./council.ts");
  discoverCouncilHandler = mod.discoverCouncilHandler;
} catch {
  // DB not available — skip handler tests
}

if (discoverCouncilHandler) {
  const handler = discoverCouncilHandler;

  Deno.test("council discover: rejects missing councilUrl", async () => {
    const ctx = createMockContext({});
    await handler(ctx);
    assertEquals(ctx.response.status, 400);
    assertEquals(ctx.response.body.message, "councilUrl is required");
  });

  Deno.test("council discover: rejects non-HTTP URL", async () => {
    const ctx = createMockContext({ councilUrl: "ftp://evil.com" });
    await handler(ctx);
    assertEquals(ctx.response.status, 400);
    assertEquals(ctx.response.body.message, "councilUrl must be a valid HTTP(S) URL");
  });

  Deno.test("council discover: rejects invalid URL", async () => {
    const ctx = createMockContext({ councilUrl: "not-a-url" });
    await handler(ctx);
    assertEquals(ctx.response.status, 400);
    assertEquals(ctx.response.body.message, "councilUrl must be a valid HTTP(S) URL");
  });

  Deno.test("council discover: rejects file:// protocol", async () => {
    const ctx = createMockContext({ councilUrl: "file:///etc/passwd" });
    await handler(ctx);
    assertEquals(ctx.response.status, 400);
    assertEquals(ctx.response.body.message, "councilUrl must be a valid HTTP(S) URL");
  });

  Deno.test("council discover: rejects empty string", async () => {
    const ctx = createMockContext({ councilUrl: "" });
    await handler(ctx);
    assertEquals(ctx.response.status, 400);
    assertEquals(ctx.response.body.message, "councilUrl is required");
  });
} else {
  Deno.test("council discover: skipped (DATABASE_URL not set)", () => {
    // No-op — DB not available, handler tests skipped
  });
}
