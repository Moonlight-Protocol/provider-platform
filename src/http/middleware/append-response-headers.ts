import type { Context } from "@oak/oak";
import { MODE } from "@/config/env.ts";

export async function appendResponseHeadersMiddleware(
  ctx: Context,
  next: () => Promise<unknown>,
) {
  const isDev = MODE === "development";
  ctx.response.headers.set("Access-Control-Allow-Origin", "*");
  ctx.response.headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS",
  );
  ctx.response.headers.set(
    "Access-Control-Allow-Headers",
    isDev ? "*" : "Content-Type, Authorization",
  );

  if (ctx.request.method === "OPTIONS") {
    ctx.response.status = 200;
    return;
  }

  await next();
}
