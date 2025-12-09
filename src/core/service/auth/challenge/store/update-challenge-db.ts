import { ProcessEngine } from "@fifo/convee";
import { Transaction } from "stellar-sdk";
import { NETWORK_CONFIG } from "@/config/env.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { ChallengeRepository } from "@/persistence/drizzle/repository/challenge.repository.ts";
import { ChallengeStatus } from "@/persistence/drizzle/entity/challenge.entity.ts";
import type {
  ContextWithJWT,
  PostChallengeWithJWT,
} from "@/core/service/auth/challenge/types.ts";
import * as E from "@/core/service/auth/challenge/store/error.ts";
import { assertOrThrow } from "@/utils/error/assert-or-throw.ts";
import { isDefined } from "@/utils/type-guards/is-defined.ts";

const challengeRepository = new ChallengeRepository(drizzleClient);

export const P_UpdateChallengeDB = ProcessEngine.create(
  async (input: PostChallengeWithJWT): Promise<ContextWithJWT> => {
    // Assume the input was already validated by an earlier process.
    const { signedChallenge } = input.body;
    const tx = new Transaction(
      signedChallenge,
      NETWORK_CONFIG.networkPassphrase
    );
    const hash = tx.hash().toString("hex");

    const challenge = await challengeRepository.findOneByTxHash(hash);
    assertOrThrow(
      isDefined(challenge),
      new E.CHALLENGE_NOT_FOUND_IN_DATABASE(hash)
    );

    challenge.status = ChallengeStatus.VERIFIED;

    await challengeRepository.update(challenge.id, {
      ...challenge,
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
