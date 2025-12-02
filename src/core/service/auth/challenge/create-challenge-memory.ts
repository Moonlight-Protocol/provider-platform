import { ProcessEngine } from "@fifo/convee";
import { sessionManager } from "@/core/service/auth/sessions/in-memory-session-manager.ts";
import type { ChallengeData } from "@/core/service/auth/challenge/types.ts";

export const P_CreateChallengeMemory = ProcessEngine.create(
  async (input: ChallengeData) => {
    const { challengeData } = input;
    try {
      if (await sessionManager.getSession(challengeData.txHash)) {
        throw new Error("Challenge session already exists");
      }

      await sessionManager.addSession(
        challengeData.txHash,
        challengeData.clientAccount,
        challengeData.requestId,
        challengeData.expiresAt
      );

      return await input;
    } catch (error) {
      console.error(error);
      throw new Error("Error caching challenge in sessions");
    }
  },
  {
    name: "CreateChallengeMemory",
  }
);
