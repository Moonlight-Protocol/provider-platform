/**
 * Mock channel resolver for tests.
 *
 * Returns a stub ChannelContext with a no-op channel client.
 * The actual balance queries are handled by mock_channel_service.ts.
 */

// deno-lint-ignore no-explicit-any
const stubChannelClient = {} as any;

// deno-lint-ignore require-await -- mock satisfies resolveChannelContext async contract
export async function resolveChannelContext(
  _channelContractId: string,
  _ppPublicKey?: string,
  _deps?: unknown,
) {
  return {
    signer: null,
    ppSecretKey: "",
    channelClient: stubChannelClient,
    txConfig: null,
  };
}

// deno-lint-ignore require-await -- mock satisfies resolveChannelClient async contract
export async function resolveChannelClient(
  _channelContractId: string,
  _deps?: unknown,
) {
  return {
    channelClient: stubChannelClient,
    channelAuthId: "",
  };
}
