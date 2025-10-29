import { type MetadataHelper, ProcessEngine } from "@fifo/convee";
import { type Operation, Transaction } from "stellar-sdk";
import { NETWORK_CONFIG } from "../../../config/env.ts";
import type { ContextWithParsedPayload } from "../../../http/utils/parse-request-payload.ts";
import type { PostAuthPayload } from "../../../http/v1/stellar/auth/post.schema.ts";
import { db } from "../../../infra/config/config.ts";

export type VerifyChallengeInput = ContextWithParsedPayload<PostAuthPayload>;
export type VerifyChallengeOutput = VerifyChallengeInput;

export const COMPARE_CHALLENGE_PROCESS = ProcessEngine.create(
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

    const txHash = tx.hash().toString("hex");

    // Look up the stored challenge record using the tx hash.
    const localChallengeDoc = await db.challenges.findByPrimaryIndex(
      "txHash",
      txHash
    );

    if (!localChallengeDoc) {
      throw new Error("Local challenge record not found");
    }

    const localChallenge = localChallengeDoc.value;

    const firstOp = tx.operations[0] as Operation.ManageData;
    const incomingNonce = firstOp.value?.toString();
    const incomingClientAccount = firstOp.source;
    const maxTime = tx.timeBounds?.maxTime
      ? parseInt(tx.timeBounds.maxTime)
      : 0;
    const expiresAt = new Date(maxTime * 1000);

    if (localChallenge.nonce !== incomingNonce) {
      throw new Error("Nonce mismatch between stored and signed challenge");
    }

    if (localChallenge.clientAccount !== incomingClientAccount) {
      throw new Error(
        "Client account mismatch between stored and signed challenge"
      );
    }

    if (localChallenge.expiresAt < expiresAt) {
      console.log(`Local challenge expires at: ${localChallenge.expiresAt}`);
      console.log(`Incoming challenge expires at: ${expiresAt}`);
      throw new Error(
        "Expiration time mismatch between stored and signed challenge"
      );
    }

    return input;
  },
  {
    name: "CompareChallengeProcessEngine",
  }
);
