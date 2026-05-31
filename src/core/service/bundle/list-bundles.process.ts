import { ProcessEngine } from "@fifo/convee";
import type { Context } from "@oak/oak";
import type { GetEndpointInput } from "@/http/pipelines/types.ts";
import type { requestSchema } from "@/http/v1/bundle/list.ts";
import type { BundleListProcessOutput } from "@/http/v1/bundle/list.ts";
import { OperationsBundleRepository } from "@/persistence/drizzle/repository/operations-bundle.repository.ts";
import { SessionRepository } from "@/persistence/drizzle/repository/session.repository.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";
import type { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import type { Logger } from "@/utils/logger/index.ts";
import * as E from "@/core/service/bundle/bundle.errors.ts";
import { toBundleDTO } from "@/core/service/bundle/bundle.service.ts";
import { withSpan } from "@/core/tracing.ts";

const operationsBundleRepository = new OperationsBundleRepository(
  drizzleClient,
);
const sessionRepository = new SessionRepository(drizzleClient);

// ========== HELPER FUNCTIONS ==========

/**
 * Validates session and returns the account ID
 */
async function validateSessionAndGetAccountId(
  sessionId: string,
  deps: { log: Logger },
): Promise<string> {
  const log = deps.log.scope("validateSessionAndGetAccountId");
  log.info("validateSessionAndGetAccountId");
  log.debug("sessionId", sessionId);

  log.event("loading session");
  const userSession = await sessionRepository.findById(sessionId);

  if (!userSession) {
    log.event("session not found");
    throw new E.INVALID_SESSION(sessionId);
  }

  return userSession.accountId;
}

/**
 * Finds bundles created by a specific account, optionally filtered by status
 */
async function findBundlesByUser(
  accountId: string,
  status: BundleStatus | undefined,
  deps: { log: Logger },
): Promise<ReturnType<typeof toBundleDTO>[]> {
  const log = deps.log.scope("findBundlesByUser");
  log.info("findBundlesByUser");
  log.debug("accountId", accountId);
  log.debug("status", status ?? "any");

  log.event("querying bundles by user");
  const bundles = await operationsBundleRepository.findByCreatedBy(
    accountId,
    status,
  );
  log.debug("bundleCount", bundles.length);
  return bundles.map(toBundleDTO);
}

// ========== MAIN PROCESS ==========

export const P_ListBundlesByUser = (deps: { log: Logger }) =>
  ProcessEngine.create(
    (
      input: GetEndpointInput<typeof requestSchema>,
    ): Promise<BundleListProcessOutput> => {
      return withSpan("P_ListBundlesByUser", async (span) => {
        const log = deps.log.scope("P_ListBundlesByUser");
        const { ctx, query } = input;
        const sessionData = ctx.state.session as JwtSessionData;

        log.debug("sessionId", sessionData.sessionId);
        log.event("validating session");

        span.addEvent("validating_session");
        const accountId = await validateSessionAndGetAccountId(
          sessionData.sessionId,
          deps,
        );

        log.debug("accountId", accountId);
        log.event("listing bundles for account");

        span.addEvent("finding_bundles", { "account.id": accountId });
        const bundles = await findBundlesByUser(accountId, query.status, deps);

        span.addEvent("bundles_found", { "bundles.count": bundles.length });

        return {
          ctx: ctx as Context,
          bundles,
        };
      });
    },
    {
      name: "ListBundlesByUserProcessEngine",
    },
  );
