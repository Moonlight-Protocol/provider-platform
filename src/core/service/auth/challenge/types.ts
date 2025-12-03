import type { Context } from "@oak/oak";
import type {
  GetEndpointInput,
  PostEndpointInput,
} from "@/http/pipelines/types.ts";
import type { requestSchema as postRequestSchema } from "@/http/v1/stellar/auth/post.ts";
import type { requestSchema as getRequestSchema } from "@/http/v1/stellar/auth/get.ts";

export type PostChallengeInput = PostEndpointInput<typeof postRequestSchema>;

export type PostChallengeWithJWT = PostChallengeInput & { jwt: string };
export type ContextWithJWT = {
  ctx: Context;
  jwt: string;
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
