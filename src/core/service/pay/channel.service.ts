/**
 * Channel service — wraps the SDK's PrivacyChannel client for on-chain queries.
 *
 * Provides lazy-initialized access to UTXO balance queries via the privacy channel.
 * Reads contract IDs and network config from the existing env/config modules.
 */
import { Buffer } from "buffer";
import { LOG } from "@/config/logger.ts";
import { ChannelReadMethods, type UTXOPublicKey, type PrivacyChannel } from "@moonlight/moonlight-sdk";

/**
 * Queries on-chain UTXO balances for the given public keys.
 *
 * @param publicKeys - Array of P256 UTXO public keys (raw bytes)
 * @returns Array of balances (in stroops) corresponding to each key
 */
export async function queryBalances(
  publicKeys: Uint8Array[],
  channelClient: PrivacyChannel,
): Promise<bigint[]> {
  if (publicKeys.length === 0) {
    return [];
  }

  try {
    const result = await channelClient.read({
      method: ChannelReadMethods.utxo_balances,
      methodArgs: {
        utxos: publicKeys.map((pk) => Buffer.from(pk)),
      },
    });

    return (result as Array<string | number | bigint>).map((balance) =>
      BigInt(balance)
    );
  } catch (error) {
    LOG.error("Failed to query UTXO balances", {
      error: error instanceof Error ? error.message : String(error),
      utxoCount: publicKeys.length,
    });
    throw error;
  }
}

/**
 * Maximum number of UTXO slots per user.
 * Used to calculate free slots in balance responses.
 */
export const MAX_UTXO_SLOTS = 300;
