import { type Context, Status } from "@oak/oak";
import { verifyDashboardChallenge } from "@/core/service/auth/dashboard-auth.ts";
import { PROVIDER_SIGNER, NETWORK_CONFIG } from "@/config/env.ts";
import generateJwt from "@/core/service/auth/generate-jwt.ts";
import { LOG } from "@/config/logger.ts";

/**
 * POST /dashboard/auth/verify
 *
 * Request body: { nonce: string, signature: string, publicKey: string }
 * Response: { token: string }
 *
 * The signature must be the Ed25519 signature of the nonce (base64).
 * The publicKey must be a signer on the PP's Stellar account.
 */
export const postVerifyHandler = async (ctx: Context) => {
  try {
    const body = await ctx.request.body.json();
    const { nonce, signature, publicKey } = body;

    if (!nonce || !signature || !publicKey) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = {
        message: "nonce, signature, and publicKey are required",
      };
      return;
    }

    const { token } = await verifyDashboardChallenge(nonce, signature, publicKey, {
      providerPublicKey: PROVIDER_SIGNER.publicKey(),
      horizonUrl: NETWORK_CONFIG.horizonUrl as string | undefined,
      generateToken: generateJwt,
    });

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Authentication successful",
      data: { token },
    };
  } catch (error) {
    LOG.warn("Dashboard auth failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.Unauthorized;
    ctx.response.body = {
      message: "Authentication failed",
    };
  }
};
