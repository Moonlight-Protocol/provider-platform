import { ProcessEngine } from "@fifo/convee";
import { sessionManager } from "@/core/service/auth/sessions/in-memory-session-manager.ts";
import type { ChallengeData } from "@/core/service/auth/challenge/types.ts";
import { logAndThrow } from "@/utils/error/log-and-throw.ts";
import * as E from "@/core/service/auth/challenge/store/error.ts";
import { isDefined } from "@/utils/type-guards/is-defined.ts";
import { assertOrThrow } from "@/utils/error/assert-or-throw.ts";

export const P_CreateChallengeMemory = ProcessEngine.create(
  async (input: ChallengeData) => {
    const { challengeData } = input;
    try {
      const existingSession = await sessionManager.getSession(
        challengeData.txHash
      );

      assertOrThrow(
        !isDefined(existingSession),
        new E.SESSION_ALREADY_EXISTS(challengeData.txHash)
      );

      await sessionManager.addSession(
        challengeData.txHash,
        challengeData.clientAccount,
        challengeData.requestId,
        challengeData.expiresAt
      );

      return await input;
    } catch (error) {
      logAndThrow(new E.FAILED_TO_CACHE_CHALLENGE_IN_LIVE_SESSIONS(error));
    }
  },
  {
    name: "CreateChallengeMemory",
  }
);
