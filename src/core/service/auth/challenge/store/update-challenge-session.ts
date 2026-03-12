import { Transaction } from "stellar-sdk";
import type { Operation } from "stellar-sdk";
import { type MetadataHelper, ProcessEngine } from "@fifo/convee";
import { LOG } from "@/config/logger.ts";
import { NETWORK_CONFIG, SESSION_TTL } from "@/config/env.ts";
import { sessionManager } from "@/core/service/auth/sessions/in-memory-session-manager.ts";
import type { Session } from "@/models/auth/session/session.model.ts";
import { AccountRepository } from "@/persistence/drizzle/repository/account.repository.ts";
import { SessionRepository } from "@/persistence/drizzle/repository/session.repository.ts";
import { SessionStatus } from "@/persistence/drizzle/entity/session.entity.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import type { PostChallengeWithJWT } from "@/core/service/auth/challenge/types.ts";
import * as E from "@/core/service/auth/challenge/store/error.ts";
import { assertOrThrow } from "@/utils/error/assert-or-throw.ts";
import { isDefined } from "@/utils/type-guards/is-defined.ts";
import { withSpan } from "@/core/tracing.ts";

const accountRepository = new AccountRepository(drizzleClient);
const sessionRepository = new SessionRepository(drizzleClient);

export const P_UpdateChallengeSession = ProcessEngine.create(
  async (
    input: PostChallengeWithJWT,
    _metadataHelper?: MetadataHelper
  ): Promise<PostChallengeWithJWT> => {
    return withSpan("P_UpdateChallengeSession", async (span) => {
      const { signedChallenge } = input.body;
      const tx = new Transaction(
        signedChallenge,
        NETWORK_CONFIG.networkPassphrase
      );

      const key = tx.hash().toString("hex");

      LOG.debug("Updating session with key", key);
      span.addEvent("updating_memory_session", { "session.key": key });

      const ttl = SESSION_TTL * 1000;

      const memorySession = await sessionManager.getSession(key);

      if (memorySession) {
        span.addEvent("memory_session_found");
        const data = {
          txHash: memorySession.txHash,
          requestId: memorySession.requestId,
          status: "ACTIVE",
          expiresAt: new Date(Date.now() + ttl),
        } as Session;

        sessionManager.updateSession(data);
      } else {
        span.addEvent("no_memory_session");
      }

      assertOrThrow(
        isDefined(tx.operations) && tx.operations.length > 0,
        new E.CHALLENGE_HAS_NO_OPERATIONS(key)
      );

      const txOperation = tx.operations[0] as Operation.ManageData;
      const txClientAccount = txOperation.source;
      assertOrThrow(isDefined(txClientAccount), new E.MISSING_CLIENT_ACCOUNT());

      span.addEvent("looking_up_account", { "client.account": txClientAccount });
      const account = await accountRepository.findById(txClientAccount);
      assertOrThrow(
        isDefined(account),
        new E.USER_NOT_FOUND_IN_DATABASE(txClientAccount)
      );

      span.addEvent("persisting_session");
      await sessionRepository.create({
        id: key,
        status: SessionStatus.ACTIVE,
        accountId: account.id,
        jwtToken: input?.jwt,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      span.addEvent("session_persisted");
      return input;
    });
  },
  {
    name: "UpdateChallengeSession",
  }
);
