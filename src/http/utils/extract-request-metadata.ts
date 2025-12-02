import type { Context } from "@oak/oak";

/**
 * Extracts metadata from the context.
 * - clientIp: from x-forwarded-for or ctx.request.ip.
 * - userAgent: from the "user-agent" header.
 * - requestId: from ctx.state.requestId if available; otherwise, generate one.
 * - expiresAt: computed as now + ttlSeconds * 1000.
 */
export function extractRequestMetadata(ctx: Context) {
  let clientIP: string;

  try {
    clientIP = ctx.request.ip;
  } catch (_error) {
    // Fallback when ctx.request.ip fails
    clientIP =
      ctx.request.headers.get("x-forwarded-for") ||
      ctx.request.headers.get("x-real-ip") ||
      ctx.request.headers.get("cf-connecting-ip") ||
      "unknown";

    // If we got a comma-separated list, take the first IP
    if (clientIP.includes(",")) {
      clientIP = clientIP.split(",")[0].trim();
    }
  }

  let requestId = ctx.state.requestId;
  if (!requestId) {
    requestId = crypto.randomUUID();
    ctx.state.requestId = requestId;
  }
  return {
    clientIp: clientIP,
    userAgent: ctx.request.headers.get("user-agent") || "unknown",
    requestId,
  };
}

export type RequestMetadata = ReturnType<typeof extractRequestMetadata>;
