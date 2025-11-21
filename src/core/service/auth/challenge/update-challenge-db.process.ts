import { ProcessEngine } from "@fifo/convee";
import { Transaction } from "stellar-sdk";
import { NETWORK_CONFIG } from "@/config/env.ts";
import type { ContextWithParsedPayload } from "@/http/utils/parse-request-payload.ts";
import type { PostAuthPayload } from "@/http/v1/stellar/auth/post.schema.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { ChallengeRepository } from "@/persistence/drizzle/repository/challenge.repository.ts";
import { ChallengeStatus } from "@/persistence/drizzle/entity/challenge.entity.ts";
import type { ContextWith } from "@/http/types.ts";

const challengeRepository = new ChallengeRepository(drizzleClient);

export type VerifyChallengeInput = ContextWithParsedPayload<PostAuthPayload>;
export type VerifyChallengeOutput = ContextWith<string, "jwt">;

export const UPDATE_CHALLENGE_DB = ProcessEngine.create(
  async (input: VerifyChallengeInput): Promise<VerifyChallengeOutput> => {
    // Assume the input was already validated by an earlier process.
    const { signedChallenge } = input.payload;
    const tx = new Transaction(
      signedChallenge,
      NETWORK_CONFIG.networkPassphrase
    );
    const hash = tx.hash().toString("hex");

    const challenge = await challengeRepository.findOneByTxHash(hash);
    if (!challenge) {
      throw new Error("Local challenge record not found");
    }

    challenge.status = ChallengeStatus.VERIFIED;

    await challengeRepository.update(challenge.id, {
      ...challenge
    });

    return {
      ctx: input.ctx,
      jwt: input.jwt!,
    };
  },
  {
    name: "UpdateChallengeDB",
  }
);

