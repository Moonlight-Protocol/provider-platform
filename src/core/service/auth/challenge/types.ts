import type { Context } from "@oak/oak";
import type {
  GetEndpointInput,
  PostEndpointInput,
} from "@/http/pipelines/types.ts";
import type { requestSchema as postRequestSchema } from "@/http/v1/stellar/auth/post.ts";
import type { requestSchema as getRequestSchema } from "@/http/v1/stellar/auth/get.ts";
import type { EntityStatus } from "@/persistence/drizzle/entity/entity.entity.ts";

export type PostChallengeInput = PostEndpointInput<typeof postRequestSchema>;

export type PostChallengeWithJWT = PostChallengeInput & { jwt: string };
export type ContextWithJWT = {
  ctx: Context;
  jwt: string;
};
// P_UpdateChallengeDB narrows from PostChallengeWithJWT to drop the full
// request body, forwarding only the single field (`ppPublicKey`) that
// P_AttachEntityStatus needs. Principle of least information.
export type ContextWithJWTAndPpPublicKey = ContextWithJWT & {
  ppPublicKey: string;
};
export type ContextWithJWTAndStatus = ContextWithJWT & {
  entityStatus: EntityStatus;
  kycSubmissionUrl: string | null;
};

export type ChallengeData = {
  ctx: Context;
  challengeData: {
    txHash: string;
    clientAccount: string;
    xdr: string;
    nonce: string;
    dateCreated: Date;
    requestId: string;
    clientIp: string;
    userAgent: string;
    expiresAt: Date;
  };
};

export type GetChallengeInput = GetEndpointInput<typeof getRequestSchema>;
