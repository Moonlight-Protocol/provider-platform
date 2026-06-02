import { decode as decodeJwt } from "@zaubrik/djwt";
import { type MetadataHelper, ProcessEngine } from "@fifo/convee";
import { AccountRepository } from "@/persistence/drizzle/repository/account.repository.ts";
import { EntityRepository } from "@/persistence/drizzle/repository/entity.repository.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { EntityStatus } from "@/persistence/drizzle/entity/entity.entity.ts";
import type {
  ContextWithJWT,
  ContextWithJWTAndStatus,
} from "@/core/service/auth/challenge/types.ts";
import type { Logger } from "@/utils/logger/index.ts";
import { withSpan } from "@/core/tracing.ts";

const accountRepository = new AccountRepository(drizzleClient);
const entityRepository = new EntityRepository(drizzleClient);

// SEP-10 verify reports the submitter's entity status alongside the JWT.
// Unregistered submitters (no account row yet) report UNVERIFIED so the
// wallet can route them to the KYC submission step instead of letting them
// blind-submit a bundle that the bundle gate (BND_011) would reject.
export const P_AttachEntityStatus = (deps: { log: Logger }) =>
  ProcessEngine.create(
    (
      input: ContextWithJWT,
      _metadataHelper?: MetadataHelper,
    ): Promise<ContextWithJWTAndStatus> => {
      return withSpan("P_AttachEntityStatus", async (span) => {
        const log = deps.log.scope("P_AttachEntityStatus");
        // We just minted this JWT in P_GenerateChallengeJWT; decode-without-
        // verify is sufficient to read its own `sub` (the client account).
        const [, payload] = decodeJwt(input.jwt);
        const clientAccount = (payload as { sub?: string }).sub;
        if (!clientAccount) {
          log.event("no sub on JWT; reporting UNVERIFIED");
          return { ...input, entityStatus: EntityStatus.UNVERIFIED };
        }
        span.addEvent("looking_up_entity", {
          "client.account": clientAccount,
        });

        const account = await accountRepository.findById(clientAccount);
        if (!account) {
          log.event("no account record for submitter; reporting UNVERIFIED");
          span.addEvent("no_account");
          return { ...input, entityStatus: EntityStatus.UNVERIFIED };
        }
        const entity = await entityRepository.findById(account.entityId);
        const entityStatus = entity?.status ?? EntityStatus.UNVERIFIED;
        span.addEvent("entity_status_attached", {
          "entity.status": entityStatus,
        });
        return { ...input, entityStatus };
      });
    },
    {
      name: "AttachEntityStatus",
    },
  );
