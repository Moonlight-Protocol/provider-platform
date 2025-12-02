import { ProcessEngine } from "@fifo/convee";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { ChallengeRepository } from "@/persistence/drizzle/repository/challenge.repository.ts";
import { UserRepository } from "@/persistence/drizzle/repository/user.repository.ts";
import { AccountRepository } from "@/persistence/drizzle/repository/account.repository.ts";
import {
  UserStatus,
  ChallengeStatus,
  type NewChallenge,
  type NewUser,
  type NewAccount,
} from "@/persistence/drizzle/entity/index.ts";
import type { ChallengeData } from "./types.ts";

const challengeRepository = new ChallengeRepository(drizzleClient);
const userRepository = new UserRepository(drizzleClient);
const accountRepository = new AccountRepository(drizzleClient);

export const P_CreateChallengeDB = ProcessEngine.create(
  async (input: ChallengeData) => {
    const { challengeData } = input;
    try {
      let account = await accountRepository.findById(
        challengeData.clientAccount
      );

      let user: NewUser | undefined;
      if (!account) {
        user = await userRepository.create({
          id: crypto.randomUUID(),
          status: UserStatus.UNVERIFIED,
        } as NewUser);

        account = await accountRepository.create({
          id: challengeData.clientAccount,
          type: "USER",
          userId: user.id,
        } as NewAccount);
      }

      await challengeRepository.create({
        id: crypto.randomUUID(),
        accountId: account.id,
        status: ChallengeStatus.UNVERIFIED,
        ttl: challengeData.expiresAt,
        txHash: challengeData.txHash,
        txXDR: challengeData.xdr,
      } as NewChallenge);

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
