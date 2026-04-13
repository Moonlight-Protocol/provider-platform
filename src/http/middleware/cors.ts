import type { Context, Next } from "@oak/oak";

const envOrigins = Deno.env.get("ALLOWED_ORIGINS");
const ALLOWED_ORIGINS = envOrigins
  ? envOrigins.split(",").map((o) => o.trim()).filter(Boolean)
  : [];

if (Deno.env.get("MODE") === "development") {
  ALLOWED_ORIGINS.push(
    "http://localhost:3000", "http://localhost:3010", "http://localhost:3020",
    "http://localhost:3050", "http://localhost:3060",
  );
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
