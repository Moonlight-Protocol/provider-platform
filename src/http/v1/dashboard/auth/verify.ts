import { type Context, Status } from "@oak/oak";
import { verifyDashboardChallenge } from "@/core/service/auth/dashboard-auth.ts";
import generateJwt from "@/core/service/auth/generate-jwt.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { WalletUserRepository } from "@/persistence/drizzle/repository/wallet-user.repository.ts";
import { LOG } from "@/config/logger.ts";

const walletUserRepo = new WalletUserRepository(drizzleClient);

/**
 * POST /dashboard/auth/verify
 *
 * Request body: { nonce: string, signature: string, publicKey: string }
 * Response: { token: string }
 *
 * Any wallet that can prove key ownership gets a dashboard JWT.
 * The signer check against the provider's Stellar account is skipped —
 * the dashboard is the operator's console, not a user-facing API.
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

    // providerPublicKey = publicKey skips the Horizon signer check.
    // This is intentional: any wallet can operate the dashboard.
    const { token } = await verifyDashboardChallenge(nonce, signature, publicKey, {
      providerPublicKey: publicKey,
      generateToken: generateJwt,
    });

    // Create user record on first sign-in
    await walletUserRepo.findOrCreate(publicKey);

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
