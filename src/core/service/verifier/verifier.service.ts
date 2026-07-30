import type { Server } from "stellar-sdk/rpc";
import type { VerificationResult } from "@/core/service/verifier/verifier.types.ts";
import { withSpan } from "@/core/tracing.ts";
import type { Logger } from "@/utils/logger/index.ts";

/**
 * Verifies a transaction on the Stellar network
 * Checks if the transaction was included in a ledger
 *
 * @param txHash - Transaction hash to verify
 * @param rpcServer - Stellar RPC server instance
 * @returns Verification result: VERIFIED, FAILED, or PENDING
 */
export function verifyTransactionOnNetwork(
  txHash: string,
  rpcServer: Server,
  deps: { log: Logger },
): Promise<VerificationResult> {
  return withSpan("Verifier.verifyTransactionOnNetwork", async (span) => {
    const log = deps.log.scope("verifyTransactionOnNetwork");
    log.info("verifyTransactionOnNetwork");
    log.debug("txHash", txHash);

    span.setAttribute("tx.hash", txHash);
    try {
      span.addEvent("querying_rpc");
      log.event("querying Stellar RPC");
      const txResponse = await rpcServer.getTransaction(txHash);
      if (!txResponse) {
        span.addEvent("transaction_not_found");
        log.event("transaction not found yet");
        return { status: "PENDING" };
      }

      if (txResponse.status === "SUCCESS") {
        span.addEvent("transaction_verified", {
          "ledger": txResponse.ledger?.toString() ?? "unknown",
        });
        log.event("transaction verified");
        log.debug("ledger", txResponse.ledger?.toString() ?? "unknown");
        return {
          status: "VERIFIED",
          ledgerSequence: txResponse.ledger?.toString(),
        };
      }

      if (txResponse.status === "FAILED") {
        const resultCode = txResponse.resultXdr || "unknown";
        span.addEvent("transaction_failed_on_network", {
          "resultCode": String(resultCode),
        });
        log.event("transaction failed on network");
        log.debug("resultCode", String(resultCode));
        return {
          status: "FAILED",
          reason: `Transaction failed with result code: ${resultCode}`,
        };
      }

      span.addEvent("transaction_status_unclear");
      log.event("transaction status unclear, treating as pending");
      return { status: "PENDING" };
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);

      // A thrown RPC error means we could not determine the on-chain outcome;
      // it is not evidence the transaction failed. Treat it as PENDING so the
      // verifier retries. If the tx genuinely never lands, the confirmation
      // timeout in verifier.process fails the bundle terminally. Previously any
      // non-"not found" error was returned as FAILED, which terminally
      // false-failed already-applied transactions on a transient RPC blip
      // (timeout / 5xx / reset), surfacing "transaction failed on-chain" for a
      // withdrawal that had in fact succeeded.
      span.addEvent("verification_rpc_error_pending", {
        "error.message": errorMessage,
      });
      log.event("RPC error during verification, treating as pending");
      log.debug("error", errorMessage);
      return { status: "PENDING" };
    }
  });
}
