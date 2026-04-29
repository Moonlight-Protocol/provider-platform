import { Router, Status } from "@oak/oak";

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

healthRouter.get("/health", (ctx) => {
  ctx.response.status = Status.OK;
  ctx.response.body = {
    status: "ok",
    service: "provider-platform",
    version,
    deps: {
      "moonlight-sdk": sdkVersion,
    },
  };
});

export default healthRouter;
