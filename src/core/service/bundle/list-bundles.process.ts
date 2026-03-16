import { ProcessEngine } from "@fifo/convee";
import type { Context } from "@oak/oak";
import { LOG } from "@/config/logger.ts";
import type { GetEndpointInput } from "@/http/pipelines/types.ts";
import type { requestSchema } from "@/http/v1/bundle/list.ts";
import type { BundleListProcessOutput } from "@/http/v1/bundle/list.ts";
import { OperationsBundleRepository } from "@/persistence/drizzle/repository/operations-bundle.repository.ts";
import { SessionRepository } from "@/persistence/drizzle/repository/session.repository.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";
import type { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import * as E from "@/core/service/bundle/bundle.errors.ts";
import { logAndThrow } from "@/utils/error/log-and-throw.ts";
import { toBundleDTO } from "@/core/service/bundle/bundle.service.ts";
import { withSpan } from "@/core/tracing.ts";

const operationsBundleRepository = new OperationsBundleRepository(drizzleClient);
const sessionRepository = new SessionRepository(drizzleClient);

// ========== HELPER FUNCTIONS ==========

/**
 * Validates session and returns the account ID
 */
async function validateSessionAndGetAccountId(sessionId: string): Promise<string> {
  const userSession = await sessionRepository.findById(sessionId);

  if (!userSession) {
    logAndThrow(new E.INVALID_SESSION(sessionId));
  }

  return userSession.accountId;
}

/**
 * Finds bundles created by a specific account, optionally filtered by status
 */
async function findBundlesByUser(
  accountId: string,
  status?: BundleStatus,
): Promise<ReturnType<typeof toBundleDTO>[]> {
  const bundles = await operationsBundleRepository.findByCreatedBy(accountId, status);
  return bundles.map(toBundleDTO);
}

// ========== MAIN PROCESS ==========

export const P_ListBundlesByUser = ProcessEngine.create(
  async (
    input: GetEndpointInput<typeof requestSchema>,
  ): Promise<BundleListProcessOutput> => {
    return withSpan("P_ListBundlesByUser", async (span) => {
      const { ctx, query } = input;
      const sessionData = ctx.state.session as JwtSessionData;

      LOG.debug("Fetching bundles for user", {
        sessionId: sessionData.sessionId,
        status: query.status,
      });

      span.addEvent("validating_session");
      const accountId = await validateSessionAndGetAccountId(sessionData.sessionId);

      span.addEvent("finding_bundles", { "account.id": accountId });
      const bundles = await findBundlesByUser(accountId, query.status);

      span.addEvent("bundles_found", { "bundles.count": bundles.length });
      LOG.debug("Bundles found", { count: bundles.length, accountId });

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

