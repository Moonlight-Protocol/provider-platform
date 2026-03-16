import { type MetadataHelper, ProcessEngine } from "@fifo/convee";
import { Transaction, TransactionBuilder } from "stellar-sdk";
import { NETWORK_CONFIG } from "@/config/env.ts";
import { ChallengeRepository } from "@/persistence/drizzle/repository/challenge.repository.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import type { PostChallengeInput } from "@/core/service/auth/challenge/types.ts";
import * as E from "@/core/service/auth/challenge/verify/error.ts";
import { assertOrThrow } from "@/utils/error/assert-or-throw.ts";
import { isDefined } from "@/utils/type-guards/is-defined.ts";
import { extractOperationFromChallengeTx } from "./extract-nonce-from-tx.ts";
import { isTransaction } from "@colibri/core";
import { withSpan } from "@/core/tracing.ts";

const challengeRepository = new ChallengeRepository(drizzleClient);

export const P_CompareChallenge = ProcessEngine.create(
  async (
    input: PostChallengeInput,
    _metadataHelper?: MetadataHelper
  ): Promise<PostChallengeInput> => {
    return withSpan("P_CompareChallenge", async (span) => {
      const { signedChallenge } = input.body;
      const tx = new Transaction(
        signedChallenge,
        NETWORK_CONFIG.networkPassphrase
      );
      assertOrThrow(isTransaction(tx), new E.CHALLENGE_IS_NOT_TRANSACTION(tx));

      const incomingTtl = extractChallengeTtl(tx);
      const txHash = tx.hash().toString("hex");

      span.addEvent("looking_up_stored_challenge", { "challenge.txHash": txHash });
      const localChallenge = await challengeRepository.findOneByTxHash(txHash);

      assertOrThrow(isDefined(localChallenge), new E.CHALLENGE_NOT_FOUND(txHash));

      const localChallengeTx = TransactionBuilder.fromXDR(
        localChallenge.txXDR,
        NETWORK_CONFIG.networkPassphrase
      );

      assertOrThrow(
        isTransaction(localChallengeTx),
        new E.CHALLENGE_IS_NOT_TRANSACTION(localChallengeTx)
      );

      span.addEvent("comparing_nonce_and_account");
      const {
        clientAccount: localChallengeClientAccount,
        nonce: localChallengeNonce,
      } = extractOperationFromChallengeTx(localChallengeTx);

      const { nonce: incomingNonce, clientAccount: incomingClientAccount } =
        extractOperationFromChallengeTx(tx);

      assertOrThrow(
        localChallengeNonce === incomingNonce,
        new E.NONCE_MISMATCH(localChallengeNonce, incomingNonce)
      );

      assertOrThrow(
        localChallengeClientAccount === incomingClientAccount,
        new E.CLIENT_ACCOUNT_MISMATCH(
          localChallengeClientAccount,
          incomingClientAccount
        )
      );

      span.addEvent("comparing_ttl");
      assertOrThrow(
        localChallenge.ttl.toDateString() === incomingTtl.toDateString(),
        new E.CHALLENGE_TTL_MISMATCH(localChallenge.ttl, incomingTtl)
      );

      span.addEvent("challenge_comparison_passed");
      return input;
    });
  },
  {
    name: "CompareChallengeProcessEngine",
  }
);

const extractChallengeTtl = (tx: Transaction): Date => {
  const maxTime = tx.timeBounds?.maxTime ? parseInt(tx.timeBounds.maxTime) : 0;
  return new Date(maxTime * 1000);
};
