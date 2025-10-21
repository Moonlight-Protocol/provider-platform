import { PermissionlessPool } from "@fifo/spp-sdk";
import { NETWORK_CONFIG, POOL_ASSET } from "../../config/env.ts";

export const POOL = new PermissionlessPool({
  networkConfig: NETWORK_CONFIG,
  assetContractId: POOL_ASSET.contractId,
});
