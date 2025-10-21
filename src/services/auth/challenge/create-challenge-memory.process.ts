import { ProcessEngine } from "@fifo/convee";
import { CreateChallengeOutput } from "./create-challenge.process.ts";
import { sessionManager } from "../sessions/in-memory-session-manager.ts";

// export class CreateChallengeMemory extends ProcessEngine<
//   CreateChallengeOutput,
//   CreateChallengeOutput,
//   Error
// > {
//   public readonly name = "CreateChallengeMemory";

//   protected async process(
//     item: CreateChallengeOutput,
//     _metadataHelper: MetadataHelper
//   ): Promise<CreateChallengeOutput> {
//     const { challengeData } = item;
//     try {
//       if (sessionManager.getSession(challengeData.txHash)) {
//         throw new Error("Challenge session already exists");
//       }

//       sessionManager.addSession(
//         challengeData.txHash,
//         challengeData.requestId,
//         challengeData.expiresAt
//       );

//       return item;
//     } catch (error) {
//       console.error(error);
//       throw new Error("Error caching challenge in sessions");
//     }
//   }
// }

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
