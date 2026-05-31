/**
 * Channel service — wraps the SDK's PrivacyChannel client for on-chain queries.
 *
 * Provides lazy-initialized access to UTXO balance queries via the privacy channel.
 * Reads contract IDs and network config from the existing env/config modules.
 */
import { Buffer } from "buffer";
import {
  ChannelReadMethods,
  type PrivacyChannel,
} from "@moonlight/moonlight-sdk";
import type { Logger } from "@/utils/logger/index.ts";

/**
 * Queries on-chain UTXO balances for the given public keys.
 *
 * @param publicKeys - Array of P256 UTXO public keys (raw bytes)
 * @returns Array of balances (in stroops) corresponding to each key
 */
export async function queryBalances(
  publicKeys: Uint8Array[],
  channelClient: PrivacyChannel,
  deps: { log: Logger },
): Promise<bigint[]> {
  const log = deps.log.scope("queryBalances");

  if (publicKeys.length === 0) {
    return [];
  }

  log.debug("utxoCount", publicKeys.length);
  log.event("querying on-chain UTXO balances");

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
    log.error(error, "failed to query UTXO balances");
    throw error;
  }
}

/**
 * Maximum number of UTXO slots per user.
 * Used to calculate free slots in balance responses.
 */
export const MAX_UTXO_SLOTS = 300;
