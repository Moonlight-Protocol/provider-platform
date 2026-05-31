import { ProcessEngine } from "@fifo/convee";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { ChallengeRepository } from "@/persistence/drizzle/repository/challenge.repository.ts";
import { EntityRepository } from "@/persistence/drizzle/repository/entity.repository.ts";
import { AccountRepository } from "@/persistence/drizzle/repository/account.repository.ts";
import {
  ChallengeStatus,
  EntityStatus,
  type NewAccount,
  type NewChallenge,
  type NewEntity,
} from "@/persistence/drizzle/entity/index.ts";
import type { ChallengeData } from "@/core/service/auth/challenge/types.ts";
import * as E from "@/core/service/auth/challenge/store/error.ts";
import { withSpan } from "@/core/tracing.ts";
import type { Logger } from "@/utils/logger/index.ts";

const challengeRepository = new ChallengeRepository(drizzleClient);
const entityRepository = new EntityRepository(drizzleClient);
const accountRepository = new AccountRepository(drizzleClient);

export const P_CreateChallengeDB = (deps: { log: Logger }) =>
  ProcessEngine.create(
    (input: ChallengeData) => {
      return withSpan("P_CreateChallengeDB", async (span) => {
        const log = deps.log.scope("P_CreateChallengeDB");
        log.info("P_CreateChallengeDB");
        const { challengeData } = input;
        log.debug("clientAccount", challengeData.clientAccount);
        log.debug("txHash", challengeData.txHash);

        try {
          span.addEvent("looking_up_account", {
            "client.account": challengeData.clientAccount,
          });
          log.event("looking up account");
          let account = await accountRepository.findById(
            challengeData.clientAccount,
          );

          let entity: NewEntity | undefined;
          if (!account) {
            span.addEvent("creating_new_entity_and_account");
            log.event("creating new entity and account");
            entity = await entityRepository.create({
              id: crypto.randomUUID(),
              status: EntityStatus.UNVERIFIED,
            } as NewEntity);

            account = await accountRepository.create({
              id: challengeData.clientAccount,
              type: "USER",
              entityId: entity.id,
            } as NewAccount);
          } else {
            span.addEvent("account_exists");
            log.event("account exists");
          }

          span.addEvent("persisting_challenge", {
            "challenge.txHash": challengeData.txHash,
          });
          log.event("persisting challenge");
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
          span.addEvent("db_store_failed", {
            "error.message": error instanceof Error
              ? error.message
              : String(error),
          });
          log.error(error, "challenge DB store failed");
          throw new E.FAILED_TO_STORE_CHALLENGE_IN_DATABASE(error);
        }
      });
    },
    {
      name: "CreateChallengeDB",
    },
  );
