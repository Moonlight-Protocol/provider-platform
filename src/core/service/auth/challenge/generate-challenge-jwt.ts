import { type MetadataHelper, ProcessEngine } from "@fifo/convee";
import { Transaction } from "stellar-sdk";
import { NETWORK_CONFIG } from "@/config/env.ts";
import type {
  PostChallengeInput,
  PostChallengeWithJWT,
} from "@/core/service/auth/challenge/types.ts";
import generateJwt from "@/core/service/auth/generate-jwt.ts";

export const P_GenerateChallengeJWT = ProcessEngine.create(
  async (
    input: PostChallengeInput,
    _metadataHelper?: MetadataHelper
  ): Promise<PostChallengeWithJWT> => {
    // Assume the input was already validated by an earlier process.
    const { signedChallenge } = input.body;
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
      body: input.body,
      jwt,
    };
  },
  {
    name: "GenerateChallengeJWT",
  }
);
