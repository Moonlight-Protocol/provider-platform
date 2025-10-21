import { MetadataHelper, ProcessEngine } from "@fifo/convee";
import { Transaction } from "stellar-sdk";
import { NETWORK_CONFIG, SESSION_TTL } from "../../../config/env.ts";
import { ContextWithParsedPayload } from "../../../api/utils/parse-request-payload.ts";
import { PostAuthPayload } from "../../../api/v1/stellar/auth/post.schema.ts";
import { db } from "../../../db/config.ts";

export type VerifyChallengeInput = ContextWithParsedPayload<PostAuthPayload>;
export type VerifyChallengeOutput = VerifyChallengeInput;

export const UPDATE_CHALLENGE_DB = ProcessEngine.create(
  async (input: VerifyChallengeInput): Promise<VerifyChallengeOutput> => {
    // Assume the input was already validated by an earlier process.
    const { signedChallenge } = input.payload;
    const tx = new Transaction(
      signedChallenge,
      NETWORK_CONFIG.networkPassphrase
    );
    const hash = tx.hash().toString("hex");

    const challengeDoc = await db.challenges.findByPrimaryIndex("txHash", hash);

    if (!challengeDoc) {
      throw new Error("Local challenge record not found");
    }
    const challenge = challengeDoc.value;

    await db.challenges.updateByPrimaryIndex("txHash", hash, {
      ...challenge,
      dateUpdated: new Date(),
      signedXdr: signedChallenge,
    });

    return input;
  },
  {
    name: "UpdateChallengeDB",
  }
);

