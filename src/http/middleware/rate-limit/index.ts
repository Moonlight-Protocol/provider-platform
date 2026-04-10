import type { Middleware } from "@oak/oak";
import { LOG } from "@/config/logger.ts";
import * as E from "@/http/middleware/rate-limit/error.ts";
import { PIPE_APIError } from "@/http/pipelines/error-pipeline.ts";

export function createRateLimitMiddleware(
  limit: number,
  windowMs: number
): Middleware {
  const rateLimitMap = new Map<string, { count: number; timestamp: number }>();
  let lastCleanupAt = 0;

  const pruneExpiredEntries = (now: number) => {
    if (rateLimitMap.size <= 1000) return;
    if (now - lastCleanupAt < windowMs) return;
    for (const [ip, entry] of rateLimitMap) {
      if (now - entry.timestamp > windowMs) rateLimitMap.delete(ip);
    }
    lastCleanupAt = now;
  };

  return async (ctx, next) => {
    try {
      const clientIP = ctx.request.ip;
      const now = Date.now();
      pruneExpiredEntries(now);

      let entry = rateLimitMap.get(clientIP);

      if (!entry || now - entry.timestamp > windowMs) {
        entry = { count: 0, timestamp: now };
      }

      entry.count++;
      rateLimitMap.set(clientIP, entry);

      LOG.debug(
        `[RateLimit] IP: ${clientIP} - Count: ${entry.count} in current window...`
      );

      if (entry.count > limit) {
        LOG.warn(`[RateLimit] Rate limit exceeded for IP: ${clientIP}`);
        return await PIPE_APIError(ctx).run(new E.EXCEEDED_LIMIT() as unknown as Error);
      }
    } catch (error) {
      const warningError = new E.FAILED_TO_DETECT_IP(error) as E.FAILED_TO_DETECT_IP & Error;
      LOG.error(warningError.message, warningError);

      // Fallback when IP detection fails
      const clientIP =
        ctx.request.headers.get("x-forwarded-for") ||
        ctx.request.headers.get("x-real-ip") ||
        "unknown";
      const now = Date.now();
      pruneExpiredEntries(now);
      let entry = rateLimitMap.get(clientIP);

      if (!entry || now - entry.timestamp > windowMs) {
        entry = { count: 0, timestamp: now };
      }

      entry.count++;
      rateLimitMap.set(clientIP, entry);

      LOG.debug(
        `[RateLimit] IP: ${clientIP} - Count: ${entry.count} in current window...`
      );

      if (entry.count > limit) {
        LOG.warn(`[RateLimit] Rate limit exceeded for IP: ${clientIP}`);
        return await PIPE_APIError(ctx).run(new E.EXCEEDED_LIMIT() as unknown as Error);
      }
    }

    await next();
  };
}
export const globalRateLimitMiddleware = createRateLimitMiddleware(
  100,
  60 * 1000
); // 100 requests per minute
export const lowRateLimitMiddleware = createRateLimitMiddleware(10, 60 * 1000); // 10 requests per minute
