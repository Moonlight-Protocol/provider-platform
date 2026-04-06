import { Router } from "@oak/oak";

// Callback endpoints (config-push, status-update) removed.
// PP now determines its own state via on-chain queries and
// the council's public membership-status endpoint.

const councilRouter = new Router();

export default councilRouter;
