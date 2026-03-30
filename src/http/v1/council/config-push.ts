import { type Context, Status } from "@oak/oak";
import { Keypair } from "stellar-sdk";
import { Buffer } from "buffer";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilMembershipRepository } from "@/persistence/drizzle/repository/council-membership.repository.ts";
import { CouncilMembershipStatus } from "@/persistence/drizzle/entity/council-membership.entity.ts";
import { setChannelConfig } from "@/config/env.ts";
import { LOG } from "@/config/logger.ts";

const membershipRepo = new CouncilMembershipRepository(drizzleClient);

interface CouncilConfig {
  councilName: string;
  councilPublicKey: string;
  channelAuthId: string;
  channels: Array<{
    channelContractId: string;
    assetCode: string;
    assetContractId: string | null;
  }>;
  jurisdictions: Array<{
    countryCode: string;
    label: string | null;
  }>;
}

interface SignedConfigEnvelope {
  payload: CouncilConfig;
  signature: string;
  publicKey: string;
}

/**
 * Verify a wallet-signed config payload.
 * The wallet signs JSON.stringify(payload) using SEP-53 format:
 *   sign(SHA-256("Stellar Signed Message:\n" + message))
 * Also tries SEP-43 and raw formats for compatibility.
 */
async function verifyWalletSignedPayload(envelope: SignedConfigEnvelope): Promise<boolean> {
  try {
    const keypair = Keypair.fromPublicKey(envelope.publicKey);
    const sigBuffer = /^[0-9a-f]+$/i.test(envelope.signature)
      ? Buffer.from(envelope.signature, "hex")
      : Buffer.from(envelope.signature, "base64");

    const messageBytes = Buffer.from(JSON.stringify(envelope.payload), "utf-8");

    // SEP-43 format
    const sep43Header = Buffer.alloc(6);
    sep43Header[0] = 0x00;
    sep43Header[1] = 0x00;
    sep43Header.writeUInt32BE(messageBytes.length, 2);
    const sep43Payload = Buffer.concat([sep43Header, messageBytes]);
    const sep43Hash = Buffer.from(await crypto.subtle.digest("SHA-256", sep43Payload));
    if (keypair.verify(sep43Hash, sigBuffer)) return true;

    // SEP-53 format
    const sep53Prefix = "Stellar Signed Message:\n";
    const sep53Payload = Buffer.concat([Buffer.from(sep53Prefix, "utf-8"), messageBytes]);
    const sep53Hash = Buffer.from(await crypto.subtle.digest("SHA-256", sep53Payload));
    if (keypair.verify(sep53Hash, sigBuffer)) return true;

    // Raw SHA-256 format (used by signPayload utility)
    const rawHash = new Uint8Array(await crypto.subtle.digest("SHA-256", messageBytes));
    if (keypair.verify(Buffer.from(rawHash), sigBuffer)) return true;

    return false;
  } catch {
    return false;
  }
}

/**
 * POST /council/config-push
 * Receives signed config from the council admin after join request approval.
 * The council-console signs the config payload with the admin's wallet.
 * No JWT required — wallet signature + signer verification provides authentication.
 */
export const configPushHandler = async (ctx: Context) => {
  try {
    const body = await ctx.request.body.json();
    const envelope = body as SignedConfigEnvelope;

    if (!envelope.payload || !envelope.signature || !envelope.publicKey) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Invalid signed payload envelope" };
      return;
    }

    // Verify signature
    const valid = await verifyWalletSignedPayload(envelope);
    if (!valid) {
      ctx.response.status = Status.Unauthorized;
      ctx.response.body = { message: "Invalid signature" };
      return;
    }

    // Find the pending membership
    const membership = await membershipRepo.getPending();
    if (!membership) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "No pending council membership found" };
      return;
    }

    // Verify the signer is the council admin we expect
    if (!membership.councilPublicKey) {
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Council public key not set on membership" };
      return;
    }
    if (membership.councilPublicKey !== envelope.publicKey) {
      LOG.warn("Config push signer mismatch", {
        expected: membership.councilPublicKey,
        got: envelope.publicKey,
      });
      ctx.response.status = Status.Forbidden;
      ctx.response.body = { message: "Signer does not match expected council admin" };
      return;
    }

    const config = envelope.payload;

    // Validate required config fields
    if (
      !config.councilName || typeof config.councilName !== "string" ||
      !config.councilPublicKey || typeof config.councilPublicKey !== "string" ||
      !config.channelAuthId || typeof config.channelAuthId !== "string" ||
      !Array.isArray(config.channels) || config.channels.length === 0 ||
      !Array.isArray(config.jurisdictions)
    ) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Config payload missing required fields or has no channels" };
      return;
    }

    // Update membership to ACTIVE with config
    await membershipRepo.update(membership.id, {
      status: CouncilMembershipStatus.ACTIVE,
      councilName: config.councilName,
      councilPublicKey: config.councilPublicKey,
      channelAuthId: config.channelAuthId,
      configJson: JSON.stringify(config),
    });

    // Update runtime config so event watcher can start
    const primaryChannel = config.channels[0];
    if (primaryChannel) {
      setChannelConfig(config.channelAuthId, primaryChannel.channelContractId);
    }

    LOG.info("Council config received and applied", {
      councilName: config.councilName,
      channelAuthId: config.channelAuthId,
      channelCount: config.channels.length,
    });

    ctx.response.status = Status.OK;
    ctx.response.body = { message: "Config received" };
  } catch (error) {
    if (error instanceof SyntaxError) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Invalid request body" };
    } else {
      LOG.error("Config push failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to process config push" };
    }
  }
};
