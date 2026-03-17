import { type Context, Status } from "@oak/oak";
import { Keypair } from "stellar-sdk";
import { createDashboardChallenge } from "@/core/service/auth/dashboard-auth.ts";

/**
 * POST /dashboard/auth/challenge
 *
 * Request body: { publicKey: string }
 * Response: { nonce: string }
 *
 * The client must sign the nonce with their Ed25519 key
 * and submit it to /dashboard/auth/verify.
 */
export const postChallengeHandler = async (ctx: Context) => {
  try {
    const body = await ctx.request.body.json();
    const { publicKey } = body;

    if (!publicKey || typeof publicKey !== "string") {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "publicKey is required" };
      return;
    }

    // Validate Stellar public key format
    try {
      Keypair.fromPublicKey(publicKey);
    } catch {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Invalid Stellar public key format" };
      return;
    }

    const { nonce } = createDashboardChallenge(publicKey);

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Challenge created",
      data: { nonce },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Challenge store overflow → 429
    if (message.includes("Too many pending challenges")) {
      ctx.response.status = 429;
      ctx.response.body = { message };
      return;
    }
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to create challenge" };
  }
};
