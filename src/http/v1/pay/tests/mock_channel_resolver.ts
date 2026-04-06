/**
 * Mock channel resolver for tests.
 *
 * Returns a stub ChannelContext with a no-op channel client.
 * The actual balance queries are handled by mock_channel_service.ts.
 */

// deno-lint-ignore no-explicit-any
const stubChannelClient = {} as any;

export async function resolveChannelContext(_channelContractId: string) {
  return {
    signer: null,
    ppSecretKey: "",
    channelClient: stubChannelClient,
    txConfig: null,
  };
}
