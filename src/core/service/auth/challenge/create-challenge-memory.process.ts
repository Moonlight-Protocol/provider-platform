import { ProcessEngine } from "@fifo/convee";
import type { CreateChallengeOutput } from "@/core/service/auth/challenge/create-challenge.process.ts";
import { sessionManager } from "@/core/service/auth/sessions/in-memory-session-manager.ts";


export const CREATE_CHALLENGE_MEMORY = ProcessEngine.create(
  async (input: CreateChallengeOutput) => {
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
