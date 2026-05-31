import { Router } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";

// Callback endpoints (config-push, status-update) removed.
// PP now determines its own state via on-chain queries and
// the council's public membership-status endpoint.

export function buildCouncilRouter(_deps: { log: Logger }): Router {
  return new Router();
}
