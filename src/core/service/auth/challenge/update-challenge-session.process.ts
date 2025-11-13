import { type MetadataHelper, ProcessEngine } from "@fifo/convee";
import { Transaction } from "stellar-sdk";
import { NETWORK_CONFIG, SESSION_TTL } from "@/config/env.ts";
import type { ContextWithParsedPayload } from "@/http/utils/parse-request-payload.ts";
import type { PostAuthPayload } from "@/http/v1/stellar/auth/post.schema.ts";
import { sessionManager } from "@/core/service/auth/sessions/in-memory-session-manager.ts";
import type { Session } from "@/models/auth/session/session.model.ts";
import { AccountRepository } from "@/persistence/drizzle/repository/account.repository.ts";
import { SessionRepository } from "@/persistence/drizzle/repository/session.repository.ts";
import { SessionStatus } from "@/persistence/drizzle/entity/session.entity.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import type { Operation } from "stellar-sdk";

export type VerifyChallengeInput = ContextWithParsedPayload<PostAuthPayload>;
export type VerifyChallengeOutput = VerifyChallengeInput;

const accountRepository = new AccountRepository(drizzleClient);
const sessionRepository = new SessionRepository(drizzleClient);

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

    const memorySession = await sessionManager.getSession(key);

    if (memorySession) {
      const data = {
        txHash: memorySession.txHash,
        requestId: memorySession.requestId,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + ttl),
      } as Session;
  
      sessionManager.updateSession(data);
    }

    const txOperation = tx.operations[0] as Operation.ManageData;
    const txClientAccount = txOperation.source;

    if (!txClientAccount) {
      throw new Error("Transaction client account is required");
    }

    const account = await accountRepository.findById(txClientAccount);
    if (!account) {
      throw new Error("User account not found in database");
    }

    // Add session to database
    await sessionRepository.create({
      id: key,
      status: SessionStatus.ACTIVE,
      accountId: account.id,
      jwtToken: input?.jwt,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return input;
  },
  {
    name: "UpdateChallengeSession",
  }
);
