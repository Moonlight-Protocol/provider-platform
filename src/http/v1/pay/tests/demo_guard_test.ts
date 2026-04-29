import { assertEquals } from "@std/assert";

/**
 * Tests for the demo route guard logic from routes.ts.
 *
 * The actual guard in routes.ts is:
 *   const networkEnv = loadOptionalEnv("NETWORK") ?? "";
 *   const demoEnabled = loadOptionalEnv("PAY_DEMO_ENABLED") === "true";
 *   if (networkEnv === "local" || networkEnv === "standalone" || demoEnabled) { ... }
 *
 * Since this logic is inline in the router module (with side-effecting imports
 * like drizzleClient, middleware, etc.), we extract and test the condition function
 * directly rather than importing the module.
 */

function shouldEnableDemoRoutes(
  network: string,
  payDemoEnabled: string | undefined,
): boolean {
  const networkEnv = network ?? "";
  const demoEnabled = payDemoEnabled === "true";
  return networkEnv === "local" || networkEnv === "standalone" || demoEnabled;
}

// --- NETWORK-based guard ---

Deno.test("demo guard - NETWORK=local enables demo routes", () => {
  assertEquals(shouldEnableDemoRoutes("local", undefined), true);
});

Deno.test("demo guard - NETWORK=standalone enables demo routes", () => {
  assertEquals(shouldEnableDemoRoutes("standalone", undefined), true);
});

Deno.test("demo guard - NETWORK=testnet disables demo routes", () => {
  assertEquals(shouldEnableDemoRoutes("testnet", undefined), false);
});

Deno.test("demo guard - NETWORK=mainnet disables demo routes", () => {
  assertEquals(shouldEnableDemoRoutes("mainnet", undefined), false);
});

Deno.test("demo guard - empty NETWORK disables demo routes", () => {
  assertEquals(shouldEnableDemoRoutes("", undefined), false);
});

// --- PAY_DEMO_ENABLED override ---

Deno.test("demo guard - PAY_DEMO_ENABLED=true overrides NETWORK=testnet", () => {
  assertEquals(shouldEnableDemoRoutes("testnet", "true"), true);
});

Deno.test("demo guard - PAY_DEMO_ENABLED=true overrides NETWORK=mainnet", () => {
  assertEquals(shouldEnableDemoRoutes("mainnet", "true"), true);
});

Deno.test("demo guard - PAY_DEMO_ENABLED=true with empty NETWORK", () => {
  assertEquals(shouldEnableDemoRoutes("", "true"), true);
});

Deno.test("demo guard - PAY_DEMO_ENABLED=false does not enable on testnet", () => {
  assertEquals(shouldEnableDemoRoutes("testnet", "false"), false);
});

Deno.test("demo guard - PAY_DEMO_ENABLED=undefined does not enable on testnet", () => {
  assertEquals(shouldEnableDemoRoutes("testnet", undefined), false);
});

Deno.test("demo guard - PAY_DEMO_ENABLED=TRUE (wrong case) does not enable", () => {
  assertEquals(shouldEnableDemoRoutes("testnet", "TRUE"), false);
});

Deno.test("demo guard - no env vars disables demo routes", () => {
  assertEquals(shouldEnableDemoRoutes("", undefined), false);
});
