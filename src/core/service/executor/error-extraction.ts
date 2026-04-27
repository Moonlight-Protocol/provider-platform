import type { Span } from "@opentelemetry/api";

/**
 * Structured failure context extracted from a network/simulation/Colibri error.
 *
 * Captures the data that Colibri's `STX_007 ERROR_STATUS`, `SIM_001 SIMULATION_FAILED`,
 * and similar errors carry under `meta.data` — which is what tells us *why* the
 * Soroban RPC rejected the transaction (txInsufficientFee, txBadAuth, host
 * panic, etc.). The provider's `lastFailureReason` previously only kept the
 * error message+stack, dropping these fields.
 */
export type NetworkErrorContext = {
  code?: string;
  domain?: string;
  source?: string;
  txHash?: string;
  errorResult?: unknown;
  diagnosticEvents?: unknown;
};

type MaybeColibri = {
  code?: unknown;
  domain?: unknown;
  source?: unknown;
  meta?: {
    data?: {
      input?: { transaction?: { hash?: () => { toString(encoding?: string): string } } };
      errorResult?: unknown;
      diagnosticEvents?: unknown;
    };
  };
};

function isString(v: unknown): v is string {
  return typeof v === "string";
}

/**
 * Best-effort extraction of Colibri/Convee error envelope fields. ConveeError
 * uses `Object.assign(this, originalError)` so the original `code`/`meta` are
 * copied onto the wrapper, which means duck-typing works through wrapping.
 */
export function extractNetworkErrorContext(error: unknown): NetworkErrorContext | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as MaybeColibri;
  if (!isString(e.code) && !e.meta?.data) return undefined;

  const ctx: NetworkErrorContext = {};
  if (isString(e.code)) ctx.code = e.code;
  if (isString(e.domain)) ctx.domain = e.domain;
  if (isString(e.source)) ctx.source = e.source;

  const data = e.meta?.data;
  if (data) {
    if (data.errorResult !== undefined) ctx.errorResult = data.errorResult;
    if (data.diagnosticEvents !== undefined) ctx.diagnosticEvents = data.diagnosticEvents;

    const tx = data.input?.transaction;
    if (tx && typeof tx.hash === "function") {
      try {
        ctx.txHash = tx.hash().toString("hex");
      } catch {
        // hash() not available on this transaction shape — skip
      }
    }
  }

  if (!ctx.code && !ctx.errorResult && !ctx.diagnosticEvents && !ctx.txHash) {
    return undefined;
  }
  return ctx;
}

/**
 * Records the extracted error context onto a span as attributes + a structured
 * event. Attributes are queryable in TraceQL (`{span.colibri.error.code = "STX_007"}`)
 * while the event carries the full payload.
 */
export function recordNetworkErrorOnSpan(span: Span, ctx: NetworkErrorContext): void {
  if (ctx.code) span.setAttribute("colibri.error.code", ctx.code);
  if (ctx.domain) span.setAttribute("colibri.error.domain", ctx.domain);
  if (ctx.source) span.setAttribute("colibri.error.source", ctx.source);
  if (ctx.txHash) span.setAttribute("tx.hash", ctx.txHash);

  const errorResultStr = ctx.errorResult !== undefined
    ? safeJson(ctx.errorResult)
    : undefined;
  const diagnosticEventsStr = ctx.diagnosticEvents !== undefined
    ? safeJson(ctx.diagnosticEvents)
    : undefined;

  if (errorResultStr || diagnosticEventsStr) {
    span.addEvent("network_error_details", {
      ...(ctx.code ? { "colibri.error.code": ctx.code } : {}),
      ...(errorResultStr ? { "error.result": errorResultStr } : {}),
      ...(diagnosticEventsStr ? { "diagnostic.events": diagnosticEventsStr } : {}),
    });
  }
}

function safeJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  } catch {
    return undefined;
  }
}
