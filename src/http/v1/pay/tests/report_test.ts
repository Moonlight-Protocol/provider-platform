/**
 * Integration tests for the report POST handler.
 *
 * No database needed — the handler just logs and returns an ID.
 * Run with: deno test --allow-all --config src/http/v1/pay/tests/deno.json src/http/v1/pay/tests/report_test.ts
 */
import { assertEquals, assertExists } from "jsr:@std/assert";
import { postReportHandler } from "@/http/v1/pay/report/post.ts";

// ---------------------------------------------------------------------------
// Mock Oak Context helper
// ---------------------------------------------------------------------------

type MockResponse = { status: number; body: unknown };

function createMockContext(
  body: unknown,
): {
  ctx: Parameters<typeof postReportHandler>[0];
  getResponse: () => MockResponse;
} {
  let responseStatus = 200;
  let responseBody: unknown = undefined;

  const ctx = {
    request: {
      body: { json: () => Promise.resolve(body) },
    },
    response: {
      get status() { return responseStatus; },
      set status(s: number) { responseStatus = s; },
      get body() { return responseBody; },
      set body(b: unknown) { responseBody = b; },
    },
    state: {},
  };

  return {
    // deno-lint-ignore no-explicit-any
    ctx: ctx as any,
    getResponse: () => ({ status: responseStatus, body: responseBody }),
  };
}

// ---------------------------------------------------------------------------
// Valid report returns 200 + id
// ---------------------------------------------------------------------------

Deno.test("report post - valid report returns 200 and id", async () => {
  const { ctx, getResponse } = createMockContext({
    description: "Something went wrong during send",
    steps: "1. Opened app\n2. Clicked send\n3. Error appeared",
    debug: {
      userAgent: "MoonlightPay/1.0",
      url: "https://app.moonlight.example/send",
      timestamp: new Date().toISOString(),
    },
  });

  await postReportHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 200, `Expected 200 but got ${res.status}: ${JSON.stringify(res.body)}`);
  assertEquals((res.body as { message: string }).message, "Report received");

  const data = (res.body as { data: { id: string } }).data;
  assertExists(data.id, "Response should contain an id");
  assertEquals(typeof data.id, "string");
  // UUID format check
  assertEquals(data.id.length, 36, "ID should be a UUID");
});

Deno.test("report post - minimal valid report (description only) returns 200", async () => {
  const { ctx, getResponse } = createMockContext({
    description: "Error occurred",
  });

  await postReportHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 200);
  assertEquals((res.body as { message: string }).message, "Report received");
  assertExists((res.body as { data: { id: string } }).data.id);
});

// ---------------------------------------------------------------------------
// Missing description returns 400
// ---------------------------------------------------------------------------

Deno.test("report post - missing description returns 400", async () => {
  const { ctx, getResponse } = createMockContext({
    steps: "Some steps",
  });

  await postReportHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 400);
  assertEquals((res.body as { message: string }).message, "description is required");
});

Deno.test("report post - empty body returns 400", async () => {
  const { ctx, getResponse } = createMockContext({});

  await postReportHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 400);
  assertEquals((res.body as { message: string }).message, "description is required");
});

Deno.test("report post - empty string description returns 400", async () => {
  const { ctx, getResponse } = createMockContext({
    description: "",
  });

  await postReportHandler(ctx);
  const res = getResponse();

  assertEquals(res.status, 400);
  assertEquals((res.body as { message: string }).message, "description is required");
});

// ---------------------------------------------------------------------------
// Invalid JSON body returns 400
// ---------------------------------------------------------------------------

Deno.test("report post - invalid JSON body returns 400", async () => {
  let responseStatus = 200;
  let responseBody: unknown = undefined;

  const ctx = {
    request: {
      body: {
        json: () => Promise.reject(new SyntaxError("Unexpected token")),
      },
    },
    response: {
      get status() { return responseStatus; },
      set status(s: number) { responseStatus = s; },
      get body() { return responseBody; },
      set body(b: unknown) { responseBody = b; },
    },
    state: {},
  };

  // deno-lint-ignore no-explicit-any
  await postReportHandler(ctx as any);

  assertEquals(responseStatus, 400);
  assertEquals((responseBody as { message: string }).message, "Invalid request body");
});
