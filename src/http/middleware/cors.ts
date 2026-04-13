import type { Context, Next } from "@oak/oak";

const DEFAULT_ORIGINS = [
  "https://provider-console.fly.storage.tigris.dev",
  "https://moonlight-council-console.fly.storage.tigris.dev",
  "https://moonlight-pay-self.fly.storage.tigris.dev",
  "https://moonlight-pay-custodial.fly.storage.tigris.dev",
];

const DEV_ORIGINS = [
  "http://localhost:3000", "http://localhost:3010", "http://localhost:3020",
  "http://localhost:3050", "http://localhost:3060",
];

const envOrigins = Deno.env.get("ALLOWED_ORIGINS");
const ALLOWED_ORIGINS = envOrigins
  ? envOrigins.split(",").map((o) => o.trim()).filter(Boolean)
  : DEFAULT_ORIGINS;

if (Deno.env.get("MODE") === "development") {
  ALLOWED_ORIGINS.push(...DEV_ORIGINS);
}

function setCorsHeaders(ctx: Context, origin: string) {
  ctx.response.headers.set("Access-Control-Allow-Origin", origin);
  ctx.response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  ctx.response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  ctx.response.headers.set("Access-Control-Max-Age", "86400");
}

export async function corsMiddleware(ctx: Context, next: Next) {
  const origin = ctx.request.headers.get("Origin");
  const allowed = origin && ALLOWED_ORIGINS.includes(origin);

  if (ctx.request.method === "OPTIONS" && allowed) {
    setCorsHeaders(ctx, origin);
    ctx.response.status = 204;
    return;
  }

  try {
    await next();
  } finally {
    if (allowed) {
      setCorsHeaders(ctx, origin!);
    }
  }
}
