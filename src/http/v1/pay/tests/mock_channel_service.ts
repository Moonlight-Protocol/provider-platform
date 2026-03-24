/**
 * Mock channel service for tests.
 *
 * Replaces @/core/service/pay/channel.service.ts to avoid importing
 * env.ts and the real PrivacyChannel SDK client.
 */

export const MAX_UTXO_SLOTS = 300;

/**
 * Mock implementation that returns zeroed balances by default.
 * Test code can override `_mockBalances` to control return values.
 */
let _mockBalances: bigint[] | null = null;

export function _setMockBalances(balances: bigint[]): void {
  _mockBalances = balances;
}

export function _resetMockBalances(): void {
  _mockBalances = null;
}

export async function queryBalances(
  publicKeys: Uint8Array[],
): Promise<bigint[]> {
  if (_mockBalances !== null) {
    return _mockBalances;
  }
  // Default: return 0n for each key
  return publicKeys.map(() => 0n);
}
