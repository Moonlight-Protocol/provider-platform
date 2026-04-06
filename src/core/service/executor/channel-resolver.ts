/**
 * Resolves the PP signer and channel client for a given channel contract ID.
 * Used by the executor to sign and submit transactions per-PP.
 */
import { LocalSigner, type TransactionConfig } from "@colibri/core";
import { Keypair } from "stellar-sdk";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PpRepository } from "@/persistence/drizzle/repository/pp.repository.ts";
import { CouncilMembershipRepository } from "@/persistence/drizzle/repository/council-membership.repository.ts";
import { CouncilMembershipStatus } from "@/persistence/drizzle/entity/council-membership.entity.ts";
import { decryptSk } from "@/core/crypto/encrypt-sk.ts";
import { getChannelClient } from "@/core/channel-client/index.ts";
import { SERVICE_AUTH_SECRET, NETWORK_FEE } from "@/config/env.ts";
import { LOG } from "@/config/logger.ts";
import type { PrivacyChannel } from "@moonlight/moonlight-sdk";

export interface ChannelContext {
  signer: LocalSigner;
  ppSecretKey: string;
  channelClient: PrivacyChannel;
  txConfig: TransactionConfig;
}

const ppRepo = new PpRepository(drizzleClient);
const membershipRepo = new CouncilMembershipRepository(drizzleClient);

/**
 * Given a channelContractId, find the PP that operates it,
 * decrypt its key, and build the channel client + tx config.
 */
export async function resolveChannelContext(channelContractId: string): Promise<ChannelContext> {
  // Find the active membership that has this channel
  const pps = await ppRepo.listActive();

  for (const pp of pps) {
    const membership = await membershipRepo.getActiveForPp(pp.publicKey);
    if (!membership?.configJson) continue;

    let config: {
      council?: { channelAuthId?: string; councilPublicKey?: string };
      channels?: Array<{ channelContractId: string; assetCode: string; assetContractId?: string }>;
    };
    try {
      config = JSON.parse(membership.configJson);
    } catch { continue; }

    const channel = config.channels?.find((ch) => ch.channelContractId === channelContractId);
    if (!channel) continue;

    const channelAuthId = config.council?.channelAuthId ?? membership.channelAuthId;

    // Decrypt the PP's secret key
    const sk = await decryptSk(pp.encryptedSk, SERVICE_AUTH_SECRET);
    if (!sk.startsWith("S")) {
      throw new Error(
        `Decrypted secret key for PP ${pp.publicKey} does not start with 'S' — the stored key may be corrupt or the decryption passphrase may have changed`,
      );
    }
    const keypair = Keypair.fromSecret(sk);
    const signer = LocalSigner.fromSecret(sk as `S${string}`);

    // Build channel client
    const client = getChannelClient(
      channelContractId,
      channelAuthId,
      channel.assetContractId ?? "",
    );

    // Build TX config — the PP's public key is the source (fee payer)
    const txConfig: TransactionConfig = {
      source: keypair.publicKey() as `G${string}`,
      fee: NETWORK_FEE,
      timeout: 30,
      signers: [signer],
    };

    return { signer, ppSecretKey: sk, channelClient: client, txConfig };
  }

  throw new Error(`No active PP found for channel ${channelContractId}`);
}
