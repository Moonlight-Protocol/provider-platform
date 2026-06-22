import { Router, Status } from "@oak/oak";
import { sql } from "drizzle-orm";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { checkDbHealth } from "@/http/v1/health/db-check.ts";

const denoJson = JSON.parse(
  await Deno.readTextFile(new URL("../../../../deno.json", import.meta.url)),
);
const version: string = denoJson.version ?? "unknown";

// Extract moonlight-sdk version from import specifier (e.g. "jsr:@moonlight/moonlight-sdk@^0.7.0" → "0.7.0")
const sdkSpecifier: string = denoJson.imports?.["@moonlight/moonlight-sdk"] ??
  "";
const sdkMatch = sdkSpecifier.match(/@\^?(\d+\.\d+\.\d+)/);
const sdkVersion = sdkMatch?.[1] ?? "unknown";

const healthRouter = new Router();

healthRouter.get("/health", async (ctx) => {
  // Bounded `SELECT 1` so a dead/unreachable DB surfaces as unhealthy without
  // hanging the endpoint. See checkDbHealth for why this does not flap deploys.
  const db = await checkDbHealth(() => drizzleClient.execute(sql`select 1`));
  const healthy = db === "ok";

  ctx.response.status = healthy ? Status.OK : Status.ServiceUnavailable;
  ctx.response.body = {
    status: healthy ? "ok" : "error",
    service: "provider-platform",
    version,
    deps: {
      "moonlight-sdk": sdkVersion,
      db,
    },
  };
});

export default healthRouter;
