import { type Context, Status } from "@oak/oak";
import { Keypair } from "stellar-sdk";
import { createEntityChallenge } from "@/core/service/auth/entity-auth.ts";
import type { Logger } from "@/utils/logger/index.ts";

/**
 * POST /api/v1/providers/:ppPublicKey/entities/challenge
 *
 * Issues a single-use nonce for an end-user (the submitter) to sign with
 * their wallet. The submitter then POSTs the signed challenge to
 * /providers/:ppPublicKey/entities along with their name + jurisdictions to
 * complete KYC/KYB registration.
 *
 * Public — no JWT required. The PP context comes from the URL.
 */
export function handlePostEntityChallenge(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("postEntityChallenge");

  return async (ctx) => {
    log.info("postEntityChallenge");
    try {
      const body = await ctx.request.body.json();
      const { pubkey } = body ?? {};
      if (!pubkey || typeof pubkey !== "string") {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "pubkey is required" };
        return;
      }
      try {
        Keypair.fromPublicKey(pubkey);
      } catch {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "Invalid Stellar public key" };
        return;
      }

      const { nonce } = createEntityChallenge(pubkey, { log });
      ctx.response.status = Status.OK;
      ctx.response.body = { message: "Challenge created", data: { nonce } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Too many pending challenges")) {
        ctx.response.status = 429;
        ctx.response.body = { message };
        return;
      }
      log.error(error, "failed to create entity challenge");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to create challenge" };
    }
  };
}
