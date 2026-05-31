/**
 * Resolves the PP signer and channel client for a (channel, PP) pair.
 *
 * Bundles are submitted to /providers/:ppPublicKey/bundles, so the PP is
 * always explicit. The resolver loads exactly that PP, verifies it is an
 * active member of the requested channel, and returns its signer. There is
 * no default / first-match across the fleet.
 */
import { LocalSigner, type TransactionConfig } from "@colibri/core";
import { Keypair } from "stellar-sdk";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PpRepository } from "@/persistence/drizzle/repository/pp.repository.ts";
import { CouncilMembershipRepository } from "@/persistence/drizzle/repository/council-membership.repository.ts";
import { decryptSk } from "@/core/crypto/encrypt-sk.ts";
import { getChannelClient } from "@/core/channel-client/index.ts";
import { NETWORK_FEE, SERVICE_AUTH_SECRET } from "@/config/env.ts";
import type { PrivacyChannel } from "@moonlight/moonlight-sdk";
import type { Logger } from "@/utils/logger/index.ts";

export interface ChannelContext {
  signer: LocalSigner;
  ppSecretKey: string;
  channelClient: PrivacyChannel;
  txConfig: TransactionConfig;
}

const ppRepo = new PpRepository(drizzleClient);
const membershipRepo = new CouncilMembershipRepository(drizzleClient);

/**
 * Returns a channel client suitable for READS only (no signer, no txConfig).
 * For writes use resolveChannelContext(channelContractId, ppPublicKey).
 */
export async function resolveChannelClient(
  channelContractId: string,
  deps: { log: Logger },
): Promise<{ channelClient: PrivacyChannel; channelAuthId: string }> {
  const log = deps.log.scope("resolveChannelClient");
  log.info("resolveChannelClient");
  log.debug("channelContractId", channelContractId);

  log.event("listing active PPs to find channel membership");
  const pps = await ppRepo.listActive();
  for (const pp of pps) {
    const membership = await membershipRepo.getActiveForPp(pp.publicKey);
    if (!membership?.configJson) continue;
    let config: {
      council?: { channelAuthId?: string };
      channels?: Array<
        {
          channelContractId: string;
          assetCode: string;
          assetContractId?: string;
        }
      >;
    };
    try {
      config = JSON.parse(membership.configJson);
    } catch {
      continue;
    }
    const channel = config.channels?.find((ch) =>
      ch.channelContractId === channelContractId
    );
    if (!channel) continue;
    const channelAuthId = config.council?.channelAuthId ??
      membership.channelAuthId;
    return {
      channelClient: getChannelClient(
        channelContractId,
        channelAuthId,
        channel.assetContractId ?? "",
      ),
      channelAuthId,
    };
  }
  throw new Error(
    `resolveChannelClient: no active membership references channel ${channelContractId}`,
  );
}

export async function resolveChannelContext(
  channelContractId: string,
  ppPublicKey: string,
  deps: { log: Logger },
): Promise<ChannelContext> {
  const log = deps.log.scope("resolveChannelContext");
  log.info("resolveChannelContext");
  log.debug("channelContractId", channelContractId);
  log.debug("ppPublicKey", ppPublicKey);

  if (!ppPublicKey) {
    throw new Error("resolveChannelContext: ppPublicKey is required");
  }

  log.event("loading PP");
  const pp = await ppRepo.findByPublicKey(ppPublicKey);
  if (!pp || !pp.isActive) {
    throw new Error(
      `resolveChannelContext: PP ${ppPublicKey} not found or inactive`,
    );
  }

  log.event("loading membership for PP");
  const membership = await membershipRepo.getActiveForPp(ppPublicKey);
  if (!membership?.configJson) {
    throw new Error(
      `resolveChannelContext: PP ${ppPublicKey} has no active membership`,
    );
  }

  let config: {
    council?: { channelAuthId?: string; councilPublicKey?: string };
    channels?: Array<
      {
        channelContractId: string;
        assetCode: string;
        assetContractId?: string;
      }
    >;
  };
  try {
    config = JSON.parse(membership.configJson);
  } catch {
    throw new Error(
      `resolveChannelContext: PP ${ppPublicKey} has malformed configJson`,
    );
  }

  const channel = config.channels?.find((ch) =>
    ch.channelContractId === channelContractId
  );
  if (!channel) {
    throw new Error(
      `resolveChannelContext: PP ${ppPublicKey} is not a member of channel ${channelContractId}`,
    );
  }

  const channelAuthId = config.council?.channelAuthId ??
    membership.channelAuthId;

  log.event("decrypting PP secret key");
  const sk = await decryptSk(pp.encryptedSk, SERVICE_AUTH_SECRET);
  if (!sk.startsWith("S")) {
    throw new Error(
      `Decrypted secret key for PP ${pp.publicKey} does not start with 'S' — the stored key may be corrupt or the decryption passphrase may have changed`,
    );
  }
  const keypair = Keypair.fromSecret(sk);
  const signer = LocalSigner.fromSecret(sk as `S${string}`);

  const client = getChannelClient(
    channelContractId,
    channelAuthId,
    channel.assetContractId ?? "",
  );

  const txConfig: TransactionConfig = {
    source: keypair.publicKey() as `G${string}`,
    fee: NETWORK_FEE,
    timeout: 30,
    signers: [signer],
  };

  return { signer, ppSecretKey: sk, channelClient: client, txConfig };
}
