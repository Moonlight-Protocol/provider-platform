/**
 * Result of verifying a transaction on the network
 */
export type VerificationResult = 
  | { status: "VERIFIED"; ledgerSequence?: string }
  | { status: "FAILED"; reason: string }
  | { status: "PENDING" };

/**
 * Transaction verification data
 */
export type TransactionVerification = {
  transactionId: string;
  result: VerificationResult;
};
