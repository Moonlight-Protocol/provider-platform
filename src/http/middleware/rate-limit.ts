import type { Middleware } from "@oak/oak";
import { LOG } from "@/config/logger.ts";
export function createRateLimitMiddleware(
  limit: number,
  windowMs: number
): Middleware {
  const rateLimitMap = new Map<string, { count: number; timestamp: number }>();

  return async (ctx, next) => {
    try {
      const clientIP = ctx.request.ip;
      const now = Date.now();
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
        ctx.response.status = 429;
        ctx.response.body = {
          message:
            "Rate limit exceeded for this route. Please try again later.",
        };
        return;
      }
    } catch (error) {
      // Fallback when IP detection fails
      const clientIP =
        ctx.request.headers.get("x-forwarded-for") ||
        ctx.request.headers.get("x-real-ip") ||
        "unknown";
      const now = Date.now();
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
        ctx.response.status = 429;
        ctx.response.body = {
          message:
            "Rate limit exceeded for this route. Please try again later.",
        };
        return;
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
