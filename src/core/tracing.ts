import { type Span, SpanStatusCode, trace } from "@opentelemetry/api";

const tracer = trace.getTracer("provider-platform");

/**
 * Wraps a function in an OpenTelemetry span with info/event/error tracing.
 *
 * - Info trace at function entry
 * - Returns the span so callers can add events at logical breaks
 * - Automatically records errors and sets span status on failure
 * - Ends span when the function completes
 */
export function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T> | T,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      if (attributes) {
        for (const [key, value] of Object.entries(attributes)) {
          span.setAttribute(key, value);
        }
      }
      span.addEvent("enter", { "function.name": name });

      const result = await fn(span);

      span.addEvent("exit", { "function.name": name });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      span.recordException(
        error instanceof Error ? error : new Error(String(error)),
      );
      span.addEvent("exit_with_error", { "function.name": name });
      throw error;
    } finally {
      span.end();
    }
  });
}

export { SpanStatusCode, tracer };
export type { Span };
