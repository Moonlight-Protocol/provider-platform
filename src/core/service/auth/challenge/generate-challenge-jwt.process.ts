import { type MetadataHelper, ProcessEngine } from "@fifo/convee";
import { Transaction } from "stellar-sdk";
import { NETWORK_CONFIG } from "@/config/env.ts";
import type { ContextWithParsedPayload } from "@/http/utils/parse-request-payload.ts";
import type { PostAuthPayload } from "@/http/v1/stellar/auth/post.schema.ts";
import generateJwt from "../generate-jwt.ts";

export type VerifyChallengeInput = ContextWithParsedPayload<PostAuthPayload>;
export type VerifyChallengeOutput = VerifyChallengeInput;

export const GENERATE_CHALLENGE_JWT_PROCESS = ProcessEngine.create(
  async (
    input: VerifyChallengeInput,
    _metadataHelper?: MetadataHelper
  ): Promise<VerifyChallengeOutput> => {
    // Assume the input was already validated by an earlier process.
    const { signedChallenge } = input.payload;
    const tx = new Transaction(
      signedChallenge,
      NETWORK_CONFIG.networkPassphrase
    );

    const key = tx.hash().toString("hex");

    const clientAccount = tx.operations[0].source;
    if (!clientAccount) {
      throw new Error("Missing account in challenge operation");
    }

    const jwt = await generateJwt(clientAccount, key);

    return {
      ctx: input.ctx,
      payload: input.payload,
      jwt,
    } as VerifyChallengeOutput;
  },
  {
    name: "GenerateChallengeJWT",
  }
);
