import { decodeContractError } from "@moonlight/moonlight-sdk";
import type { NetworkErrorContext } from "@/core/service/executor/error-extraction.ts";

/**
 * Structured, safe failure identity persisted to a bundle's `failureDetail`
 * and returned verbatim in the API body. This is the edge translation of an
 * internal error chain into a stable machine code — it must NOT carry stack
 * frames, raw internal messages, or secrets. The UI maps `code` to copy.
 */
export interface StructuredFailureDetail {
  /** Stable machine code, e.g. `SOROBAN_1010` or `PROVIDER_EXECUTION_FAILED`. */
  code: string;
  /** Origin layer of the root cause. */
  source: "onchain" | "provider";
  /** Safe, human-readable summary (no internal detail). */
  message: string;
  /** On-chain variant name when the root cause is a decoded contract error. */
  name?: string;
}

/**
 * Whether a failure is deterministic (will fail identically on retry) — true
 * for decoded on-chain contract reverts, false for transient/network errors.
 * Drives the retry decision (#12): never retry a deterministic revert.
 */
export function isDeterministic(error: unknown): boolean {
  return decodeContractError(error) !== null;
}

/**
 * Translate a terminal execution failure into a {@link StructuredFailureDetail}.
 *
 * A decoded on-chain contract revert becomes `SOROBAN_<code>` with its catalog
 * name/description. Anything else (network, RPC, build) collapses to a single
 * safe provider code — the rich internal cause stays in `lastFailureReason`
 * and the span, never in this edge payload.
 */
export function buildFailureDetail(
  error: unknown,
  _networkCtx?: NetworkErrorContext,
): StructuredFailureDetail {
  const decoded = decodeContractError(error);
  if (decoded) {
    return {
      code: `SOROBAN_${decoded.code}`,
      source: "onchain",
      name: decoded.name,
      message: decoded.details || `On-chain rejection ${decoded.name}`,
    };
  }
  return {
    code: "PROVIDER_EXECUTION_FAILED",
    source: "provider",
    message: "The bundle could not be submitted to the network.",
  };
}
