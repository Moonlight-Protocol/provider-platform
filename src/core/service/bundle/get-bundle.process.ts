import { ProcessEngine } from "@fifo/convee";
import type { Context } from "@oak/oak";
import { LOG } from "@/config/logger.ts";
import type { GetEndpointInput } from "@/http/pipelines/types.ts";
import type { requestSchema } from "@/http/v1/bundle/get.ts";
import { responseSchema } from "@/http/v1/bundle/get.ts";
import type { BundleGetProcessOutput } from "@/http/v1/bundle/get.ts";
import { OperationsBundleRepository } from "@/persistence/drizzle/repository/operations-bundle.repository.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import type { OperationsBundle } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import * as E from "./bundle.errors.ts";
import { logAndThrow } from "@/utils/error/log-and-throw.ts";

const operationsBundleRepository = new OperationsBundleRepository(drizzleClient);

// ========== HELPER FUNCTIONS ==========

async function findBundleOrThrow(bundleId: string): Promise<OperationsBundle> {
  const bundle = await operationsBundleRepository.findById(bundleId);

  if (!bundle) {
    logAndThrow(new E.BUNDLE_NOT_FOUND(bundleId));
  }

  return bundle;
}

function toBundleDTO(bundle: OperationsBundle): BundleGetProcessOutput["bundle"] {
  return {
    id: bundle.id,
    status: bundle.status,
    ttl: bundle.ttl.toISOString(),
    createdAt: bundle.createdAt.toISOString(),
    updatedAt: bundle.updatedAt ? bundle.updatedAt.toISOString() : null,
  };
}

// ========== MAIN PROCESS ==========

export const P_GetBundleById = ProcessEngine.create(
  async (
    input: GetEndpointInput<typeof requestSchema>,
  ): Promise<BundleGetProcessOutput> => {
    const { ctx, query } = input;
    const { bundleId } = query;

    LOG.debug("Fetching bundle by ID", { bundleId });

    const bundle = await findBundleOrThrow(bundleId);
    const dto = toBundleDTO(bundle);

    // Validate DTO against response schema (defensive)
    const parsed = responseSchema.parse(dto);

    return {
      ctx: ctx as Context,
      bundle: parsed,
    };
  },
  {
    name: "GetBundleByIdProcessEngine",
  },
);
