import type { Server } from "stellar-sdk/rpc";
import type { VerificationResult } from "@/core/service/verifier/verifier.types.ts";
import { withSpan } from "@/core/tracing.ts";

/**
 * Verifies a transaction on the Stellar network
 * Checks if the transaction was included in a ledger
 *
 * @param txHash - Transaction hash to verify
 * @param rpcServer - Stellar RPC server instance
 * @returns Verification result: VERIFIED, FAILED, or PENDING
 */
export async function verifyTransactionOnNetwork(
  txHash: string,
  rpcServer: Server
): Promise<VerificationResult> {
  return withSpan("Verifier.verifyTransactionOnNetwork", async (span) => {
    span.setAttribute("tx.hash", txHash);
    try {
      span.addEvent("querying_rpc");
      const txResponse = await rpcServer.getTransaction(txHash);
      if (!txResponse) {
        span.addEvent("transaction_not_found");
        return { status: "PENDING" };
      }

      if (txResponse.status === "SUCCESS") {
        span.addEvent("transaction_verified", { "ledger": txResponse.ledger?.toString() ?? "unknown" });
        return {
          status: "VERIFIED",
          ledgerSequence: txResponse.ledger?.toString(),
        };
      }

      if (txResponse.status === "FAILED") {
        const resultCode = txResponse.resultXdr || "unknown";
        span.addEvent("transaction_failed_on_network", { "resultCode": String(resultCode) });
        return {
          status: "FAILED",
          reason: `Transaction failed with result code: ${resultCode}`,
        };
      }

      span.addEvent("transaction_status_unclear");
      return { status: "PENDING" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("not found") || errorMessage.includes("404")) {
        span.addEvent("transaction_pending_not_found");
        return { status: "PENDING" };
      }

      span.addEvent("verification_error", { "error.message": errorMessage });
      return {
        status: "FAILED",
        reason: errorMessage,
      };
    }
  });
}
