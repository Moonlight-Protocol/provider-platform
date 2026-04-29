import { assertEquals } from "@std/assert";
import { signPayload, verifyPayload } from "./signed-payload.ts";

const TEST_SECRET = "SDEBQNNLMYRVLIQU2QVEOHB6F457WZ7URLDXYAU62C7KSQRCCJ37AMPJ";
const TEST_PUBLIC = "GATEFB5DJB4Q6JU6XMYR2OV3DRLLQMCMGY44HMUYAXSLXQSDID5SY2W7";

Deno.test("signPayload produces a valid envelope", async () => {
  const payload = { name: "test", value: 42 };
  const envelope = await signPayload(payload, TEST_SECRET);

  assertEquals(envelope.publicKey, TEST_PUBLIC);
  assertEquals(envelope.payload, payload);
  assertEquals(typeof envelope.signature, "string");
  assertEquals(typeof envelope.timestamp, "number");
  assertEquals(envelope.signature.length > 0, true);
});

Deno.test("verifyPayload accepts a valid fresh envelope", async () => {
  const payload = { name: "test" };
  const envelope = await signPayload(payload, TEST_SECRET);
  const valid = await verifyPayload(envelope);
  assertEquals(valid, true);
});

Deno.test("verifyPayload rejects a tampered payload", async () => {
  const payload = { name: "test" };
  const envelope = await signPayload(payload, TEST_SECRET);
  envelope.payload = { name: "tampered" } as typeof payload;
  const valid = await verifyPayload(envelope);
  assertEquals(valid, false);
});

Deno.test("verifyPayload rejects an expired envelope", async () => {
  const payload = { name: "test" };
  const envelope = await signPayload(payload, TEST_SECRET);
  envelope.timestamp = Date.now() - 10 * 60 * 1000; // 10 min ago
  const valid = await verifyPayload(envelope);
  assertEquals(valid, false);
});

Deno.test("verifyPayload rejects a future-dated envelope", async () => {
  const payload = { name: "test" };
  const envelope = await signPayload(payload, TEST_SECRET);
  envelope.timestamp = Date.now() + 10 * 60 * 1000; // 10 min in future
  const valid = await verifyPayload(envelope);
  assertEquals(valid, false);
});

Deno.test("verifyPayload rejects a missing timestamp", async () => {
  const payload = { name: "test" };
  const envelope = await signPayload(payload, TEST_SECRET);
  (envelope as unknown as Record<string, unknown>).timestamp = undefined;
  const valid = await verifyPayload(envelope);
  assertEquals(valid, false);
});

Deno.test("verifyPayload rejects a wrong public key", async () => {
  const payload = { name: "test" };
  const envelope = await signPayload(payload, TEST_SECRET);
  envelope.publicKey =
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const valid = await verifyPayload(envelope);
  assertEquals(valid, false);
});

Deno.test("verifyPayload rejects with custom short maxAge", async () => {
  const payload = { name: "test" };
  // Fresh envelope: valid under default 5 min
  const envelope = await signPayload(payload, TEST_SECRET);
  const validDefault = await verifyPayload(envelope);
  assertEquals(validDefault, true);
  // Same envelope with 0ms maxAge: should fail (any age > 0 rejected)
  const valid0 = await verifyPayload(envelope, 0);
  assertEquals(valid0, false);
});
