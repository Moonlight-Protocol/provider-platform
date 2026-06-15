import { assertEquals } from "@std/assert";
import { newNoop } from "@/utils/logger/index.ts";
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
  const registry = new ChannelRegistry([CONTRACT_A], { log: newNoop() });
  registry.handleEvent(makeEvent("provider_added", CONTRACT_A, 100));

  const channel = registry.get(CONTRACT_A);
  assertEquals(channel?.state, "active");
  assertEquals(channel?.registeredAtLedger, 100);
});

Deno.test("ChannelRegistry - provider_added for unconfigured channel → pending", () => {
  const registry = new ChannelRegistry([], { log: newNoop() });
  registry.handleEvent(makeEvent("provider_added", CONTRACT_A, 100));

  const channel = registry.get(CONTRACT_A);
  assertEquals(channel?.state, "pending");
});

Deno.test("ChannelRegistry - provider_removed → inactive", () => {
  const registry = new ChannelRegistry([CONTRACT_A], { log: newNoop() });
  registry.handleEvent(makeEvent("provider_added", CONTRACT_A, 100));
  registry.handleEvent(makeEvent("provider_removed", CONTRACT_A, 200));

  const channel = registry.get(CONTRACT_A);
  assertEquals(channel?.state, "inactive");
  assertEquals(channel?.removedAtLedger, 200);
});

Deno.test("ChannelRegistry - provider_removed for unknown channel → inactive record", () => {
  const registry = new ChannelRegistry([], { log: newNoop() });
  registry.handleEvent(makeEvent("provider_removed", CONTRACT_A, 200));

  const channel = registry.get(CONTRACT_A);
  assertEquals(channel?.state, "inactive");
  assertEquals(channel?.removedAtLedger, 200);
});

Deno.test("ChannelRegistry - getAll returns all channels", () => {
  const registry = new ChannelRegistry([CONTRACT_A], { log: newNoop() });
  registry.handleEvent(makeEvent("provider_added", CONTRACT_A, 100));
  registry.handleEvent(makeEvent("provider_added", CONTRACT_B, 101));

  assertEquals(registry.getAll().length, 2);
});

Deno.test("ChannelRegistry - getByState filters correctly", () => {
  const registry = new ChannelRegistry([CONTRACT_A], { log: newNoop() });
  registry.handleEvent(makeEvent("provider_added", CONTRACT_A, 100));
  registry.handleEvent(makeEvent("provider_added", CONTRACT_B, 101));

  assertEquals(registry.getByState("active").length, 1);
  assertEquals(registry.getByState("pending").length, 1);
  assertEquals(registry.getByState("inactive").length, 0);
});

Deno.test("ChannelRegistry - activateChannel transitions pending → active", () => {
  const registry = new ChannelRegistry([], { log: newNoop() });
  registry.handleEvent(makeEvent("provider_added", CONTRACT_A, 100));
  assertEquals(registry.get(CONTRACT_A)?.state, "pending");

  registry.activateChannel(CONTRACT_A);
  assertEquals(registry.get(CONTRACT_A)?.state, "active");
});

Deno.test("ChannelRegistry - deactivateChannel transitions active → pending", () => {
  const registry = new ChannelRegistry([CONTRACT_A], { log: newNoop() });
  registry.handleEvent(makeEvent("provider_added", CONTRACT_A, 100));
  assertEquals(registry.get(CONTRACT_A)?.state, "active");

  registry.deactivateChannel(CONTRACT_A);
  assertEquals(registry.get(CONTRACT_A)?.state, "pending");
});

Deno.test("ChannelRegistry - contract_initialized does not create channel record", () => {
  const registry = new ChannelRegistry([], { log: newNoop() });
  registry.handleEvent(makeEvent("contract_initialized", CONTRACT_A, 50));

  assertEquals(registry.getAll().length, 0);
});

// --- Asset-channel lifecycle (channel_state_changed) ---

const PRIVACY_CHANNEL =
  "CCHANNELAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4";
const ASSET = "CASSETAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHK3M";

function makeStateEvent(
  channel: string,
  asset: string,
  enabled: boolean,
  ledger: number,
): ChannelAuthEvent {
  return {
    type: "channel_state_changed",
    address: channel,
    channel,
    asset,
    enabled,
    contractId: CONTRACT_A,
    ledger,
  };
}

Deno.test("ChannelRegistry - channel_state_changed disabled → disabled state", async () => {
  const registry = new ChannelRegistry([], { log: newNoop() });
  await registry.handleEvent(
    makeStateEvent(PRIVACY_CHANNEL, ASSET, false, 300),
  );

  assertEquals(registry.get(PRIVACY_CHANNEL)?.state, "disabled");
  assertEquals(registry.isDisabled(PRIVACY_CHANNEL), true);
});

Deno.test("ChannelRegistry - re-enable returns channel to active", async () => {
  const registry = new ChannelRegistry([], { log: newNoop() });
  await registry.handleEvent(
    makeStateEvent(PRIVACY_CHANNEL, ASSET, false, 300),
  );
  assertEquals(registry.isDisabled(PRIVACY_CHANNEL), true);

  await registry.handleEvent(makeStateEvent(PRIVACY_CHANNEL, ASSET, true, 310));
  assertEquals(registry.get(PRIVACY_CHANNEL)?.state, "active");
  assertEquals(registry.isDisabled(PRIVACY_CHANNEL), false);
});

Deno.test("ChannelRegistry - isDisabled is false for unknown channel (fail open)", () => {
  const registry = new ChannelRegistry([], { log: newNoop() });
  assertEquals(registry.isDisabled(PRIVACY_CHANNEL), false);
});

Deno.test("ChannelRegistry - applyChannelState converges from query", async () => {
  const registry = new ChannelRegistry([], { log: newNoop() });
  // Simulates boot/out-of-retention convergence from the council query.
  await registry.applyChannelState(PRIVACY_CHANNEL, false);
  assertEquals(registry.isDisabled(PRIVACY_CHANNEL), true);

  await registry.applyChannelState(PRIVACY_CHANNEL, true);
  assertEquals(registry.isDisabled(PRIVACY_CHANNEL), false);
});

Deno.test("ChannelRegistry - getByState includes disabled", async () => {
  const registry = new ChannelRegistry([], { log: newNoop() });
  await registry.handleEvent(
    makeStateEvent(PRIVACY_CHANNEL, ASSET, false, 300),
  );

  assertEquals(registry.getByState("disabled").length, 1);
});
