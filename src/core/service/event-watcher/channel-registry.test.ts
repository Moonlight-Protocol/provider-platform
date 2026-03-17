import { assertEquals } from "jsr:@std/assert";
import { ChannelRegistry } from "./channel-registry.ts";
import type { ChannelAuthEvent } from "./event-watcher.types.ts";

const CONTRACT_A = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4";
const CONTRACT_B = "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBHK3M";
const PROVIDER = "GDUY7J7A33TQWOSOQGDO776GGLM3UQERL4J3SPT56F6YS4ID7MLDERI";

function makeEvent(
  type: ChannelAuthEvent["type"],
  contractId: string,
  ledger: number,
): ChannelAuthEvent {
  return { type, address: PROVIDER, contractId, ledger };
}

Deno.test("ChannelRegistry - provider_added for configured channel → active", () => {
  const registry = new ChannelRegistry([CONTRACT_A]);
  registry.handleEvent(makeEvent("provider_added", CONTRACT_A, 100));

  const channel = registry.get(CONTRACT_A);
  assertEquals(channel?.state, "active");
  assertEquals(channel?.registeredAtLedger, 100);
});

Deno.test("ChannelRegistry - provider_added for unconfigured channel → pending", () => {
  const registry = new ChannelRegistry([]);
  registry.handleEvent(makeEvent("provider_added", CONTRACT_A, 100));

  const channel = registry.get(CONTRACT_A);
  assertEquals(channel?.state, "pending");
});

Deno.test("ChannelRegistry - provider_removed → inactive", () => {
  const registry = new ChannelRegistry([CONTRACT_A]);
  registry.handleEvent(makeEvent("provider_added", CONTRACT_A, 100));
  registry.handleEvent(makeEvent("provider_removed", CONTRACT_A, 200));

  const channel = registry.get(CONTRACT_A);
  assertEquals(channel?.state, "inactive");
  assertEquals(channel?.removedAtLedger, 200);
});

Deno.test("ChannelRegistry - provider_removed for unknown channel → inactive record", () => {
  const registry = new ChannelRegistry([]);
  registry.handleEvent(makeEvent("provider_removed", CONTRACT_A, 200));

  const channel = registry.get(CONTRACT_A);
  assertEquals(channel?.state, "inactive");
  assertEquals(channel?.removedAtLedger, 200);
});

Deno.test("ChannelRegistry - getAll returns all channels", () => {
  const registry = new ChannelRegistry([CONTRACT_A]);
  registry.handleEvent(makeEvent("provider_added", CONTRACT_A, 100));
  registry.handleEvent(makeEvent("provider_added", CONTRACT_B, 101));

  assertEquals(registry.getAll().length, 2);
});

Deno.test("ChannelRegistry - getByState filters correctly", () => {
  const registry = new ChannelRegistry([CONTRACT_A]);
  registry.handleEvent(makeEvent("provider_added", CONTRACT_A, 100));
  registry.handleEvent(makeEvent("provider_added", CONTRACT_B, 101));

  assertEquals(registry.getByState("active").length, 1);
  assertEquals(registry.getByState("pending").length, 1);
  assertEquals(registry.getByState("inactive").length, 0);
});

Deno.test("ChannelRegistry - activateChannel transitions pending → active", () => {
  const registry = new ChannelRegistry([]);
  registry.handleEvent(makeEvent("provider_added", CONTRACT_A, 100));
  assertEquals(registry.get(CONTRACT_A)?.state, "pending");

  registry.activateChannel(CONTRACT_A);
  assertEquals(registry.get(CONTRACT_A)?.state, "active");
});

Deno.test("ChannelRegistry - deactivateChannel transitions active → pending", () => {
  const registry = new ChannelRegistry([CONTRACT_A]);
  registry.handleEvent(makeEvent("provider_added", CONTRACT_A, 100));
  assertEquals(registry.get(CONTRACT_A)?.state, "active");

  registry.deactivateChannel(CONTRACT_A);
  assertEquals(registry.get(CONTRACT_A)?.state, "pending");
});

Deno.test("ChannelRegistry - contract_initialized does not create channel record", () => {
  const registry = new ChannelRegistry([]);
  registry.handleEvent(makeEvent("contract_initialized", CONTRACT_A, 50));

  assertEquals(registry.getAll().length, 0);
});
