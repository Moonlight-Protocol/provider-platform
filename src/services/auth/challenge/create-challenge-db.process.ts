import { ProcessEngine } from "@fifo/convee";
import { CreateChallengeOutput } from "./create-challenge.process.ts";
import { db } from "../../../infra/config/config.ts";
import { User } from "../../../models/user/user.model.ts";

export const CREATE_CHALLENGE_DB = ProcessEngine.create(
  async (input: CreateChallengeOutput) => {
    const { challengeData } = input;
    try {
      const user = await db.users.findByPrimaryIndex(
        "publicKey",
        challengeData.clientAccount
      );

      if (!user) {
        const cr = await db.users
          .add({
            publicKey: challengeData.clientAccount,
            dateCreated: challengeData.dateCreated,
            dateUpdated: challengeData.dateCreated,
          } as User)
          .catch((e) => {
            console.error("error adding user", e);
          });
      }

      const cr = await db.challenges.add({
        ...challengeData,
        dateUpdated: challengeData.dateCreated,
      });

      if (!cr.ok) {
        console.log("Challenge could not be stored in DB!", cr);
      }

      return await input;
    } catch (error) {
      console.error(error);
      throw new Error("Error storing challenge in DB");
    }
  },
  {
    name: "CreateChallengeDB",
  }
);

// export class CreateChallengeDB extends ProcessEngine<
//   CreateChallengeOutput,
//   CreateChallengeOutput,
//   Error
// > {
//   public readonly name = "CreateChallengeDB";

//   protected async process(
//     item: CreateChallengeOutput,
//     _metadataHelper: MetadataHelper
//   ): Promise<CreateChallengeOutput> {
//     const { challengeData } = item;
//     try {
//       const users = await findUserByPk(challengeData.clientAccount);
//       if (users.length === 0) {
//         await insertUser({
//           publicKey: challengeData.clientAccount,
//           dateCreated: challengeData.dateCreated,
//           dateUpdated: challengeData.dateCreated,
//         });
//       }

//       await insertChallenge({
//         ...challengeData,
//         dateUpdated: challengeData.dateCreated,
//       });

//       return item;
//     } catch (error) {
//       console.error(error);
//       throw new Error("Error storing challenge in DB");
//     }
//   }
// }

// // export const CREATE_CHALLENGE_DB = new CreateChallengeDB();
