import { z } from "zod";
import { type Context, Status } from "@oak/oak";
import { P_VerifyChallenge } from "@/core/service/auth/challenge/verify/verify-challenge.ts";
import { P_UpdateChallengeSession } from "@/core/service/auth/challenge/store/update-challenge-session.ts";
import { P_UpdateChallengeDB } from "@/core/service/auth/challenge/store/update-challenge-db.ts";
import { P_GenerateChallengeJWT } from "@/core/service/auth/challenge/create/generate-challenge-jwt.ts";
import { P_AttachEntityStatus } from "@/core/service/auth/challenge/store/attach-entity-status.ts";
import type { PostEndpointOutput } from "@/http/pipelines/types.ts";
import { PIPE_PostEndpoint } from "@/http/pipelines/post-endpoint.ts";
import { P_CompareChallenge } from "@/core/service/auth/challenge/verify/compare-challenge.ts";
import type { ContextWithJWTAndStatus } from "@/core/service/auth/challenge/types.ts";
import { EntityStatus } from "@/persistence/drizzle/entity/entity.entity.ts";
import type { Logger } from "@/utils/logger/index.ts";

// SEP-10 verify is now PP-aware: the wallet posts `ppPublicKey` alongside
// the signed challenge so the response can carry per-PP `entityStatus` and
// per-PP `kycSubmissionUrl`. A wallet APPROVED on PP-A must not appear
// APPROVED on PP-B.
export const requestSchema = z.object({
  signedChallenge: z.string(),
  ppPublicKey: z.string().min(1),
});

export const responseSchema = z.object({
  jwt: z.string(),
  entityStatus: z.nativeEnum(EntityStatus),
  kycSubmissionUrl: z.string().nullable(),
});

export function handlePostAuth(
  deps: { log: Logger },
): (ctx: Context) => Promise<unknown> {
  const log = deps.log.scope("postAuth");

  const assembleResponse = (
    input: ContextWithJWTAndStatus,
  ): PostEndpointOutput<typeof responseSchema> => {
    log.event("auth challenge verified successfully");

    return {
      ctx: input.ctx,
      status: Status.OK,
      message: "Auth challenge verified successfully",
      data: {
        jwt: input.jwt,
        entityStatus: input.entityStatus,
        kycSubmissionUrl: input.kycSubmissionUrl,
      },
    };
  };

  return (ctx) => {
    log.info("postAuth");
    const handler = PIPE_PostEndpoint({
      name: "PostAuthEndpointPipeline",
      requestSchema: requestSchema,
      responseSchema: responseSchema,
      steps: [
        P_VerifyChallenge(deps),
        P_CompareChallenge(deps),
        P_GenerateChallengeJWT(deps),
        P_UpdateChallengeSession(deps),
        P_UpdateChallengeDB(deps),
        P_AttachEntityStatus(deps),
        assembleResponse,
      ] as const,
    }, deps);

    return handler.run(ctx);
  };
}
