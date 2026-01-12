import type { Server } from "stellar-sdk/rpc";
import type { VerificationResult } from "@/core/service/verifier/verifier.types.ts";

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
  try {
    // Try to get transaction by hash
    const txResponse = await rpcServer.getTransaction(txHash);
    
    if (!txResponse) {
      // Transaction not found - might be pending or failed
      return { status: "PENDING" };
    }

    // Check if transaction was successful
    if (txResponse.successful === true) {
      return {
        status: "VERIFIED",
        ledgerSequence: txResponse.ledger?.toString(),
      };
    }

    // Transaction was included but failed
    if (txResponse.successful === false) {
      const resultCode = txResponse.resultXdr || "unknown";
      return {
        status: "FAILED",
        reason: `Transaction failed with result code: ${resultCode}`,
      };
    }

    // Transaction found but status unclear
    return { status: "PENDING" };
  } catch (error) {
    // If transaction is not found, it might still be pending
    // Check if it's a 404 or similar
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    if (errorMessage.includes("not found") || errorMessage.includes("404")) {
      return { status: "PENDING" };
    }

    // Other errors might indicate the transaction failed
    return {
      status: "FAILED",
      reason: errorMessage,
    };
  }
}
