import type { Context, Next } from "@oak/oak";
import { context, propagation, SpanStatusCode } from "@opentelemetry/api";
import { tracer } from "@/core/tracing.ts";

/**
 * Oak middleware that extracts W3C trace context (traceparent header) from
 * incoming requests and makes it the active context for downstream handlers.
 *
 * Oak breaks Deno's async context chain, so without this middleware,
 * spans created by withSpan() become root traces instead of children
 * of the incoming request's trace.
 */
export async function traceContextMiddleware(ctx: Context, next: Next) {
  const headers: Record<string, string> = {};
  for (const [key, value] of ctx.request.headers) {
    headers[key] = value;
  }

  const extractedContext = propagation.extract(context.active(), headers);
  const method = ctx.request.method;
  const path = new URL(ctx.request.url).pathname;

  await context.with(extractedContext, () =>
    tracer.startActiveSpan(`${method} ${path}`, async (span) => {
      span.setAttribute("http.request.method", method);
      span.setAttribute("url.path", path);
      try {
        await next();
        span.setAttribute("http.response.status_code", ctx.response.status);
      } catch (error) {
        span.setAttribute("http.response.status_code", 500);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        span.recordException(
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      } finally {
        span.end();
      }
    })
  );
}
