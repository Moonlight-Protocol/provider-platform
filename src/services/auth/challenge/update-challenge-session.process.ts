import { type MetadataHelper, ProcessEngine } from "@fifo/convee";
import { Transaction } from "stellar-sdk";
import { NETWORK_CONFIG, SESSION_TTL } from "../../../config/env.ts";
import type { ContextWithParsedPayload } from "../../../http/utils/parse-request-payload.ts";
import type { PostAuthPayload } from "../../../http/v1/stellar/auth/post.schema.ts";
import { sessionManager } from "../sessions/in-memory-session-manager.ts";
import type { Session } from "../../../models/auth/session/session.model.ts";

export type VerifyChallengeInput = ContextWithParsedPayload<PostAuthPayload>;
export type VerifyChallengeOutput = VerifyChallengeInput;

export const UPDATE_CHALLENGE_SESSION = ProcessEngine.create(
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

    console.log("Updating session with key", key);

    const ttl = SESSION_TTL * 1000;

    const oldSession = await sessionManager.getSession(key);

    if (!oldSession) {
      throw new Error("Session not found");
    }

    const data = {
      txHash: oldSession.txHash,
      requestId: oldSession.requestId,
      status: "ACTIVE",
      expiresAt: new Date(Date.now() + ttl),
    } as Session;

    sessionManager.updateSession(data);

    return input;
  },
  {
    name: "UpdateChallengeSession",
  }
);
