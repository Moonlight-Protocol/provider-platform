import type { MoonlightTransactionBuilder } from "@moonlight/moonlight-sdk";

/**
 * Result of building a transaction from a slot
 */
export type TransactionBuildResult = {
  txBuilder: MoonlightTransactionBuilder;
  totalFee: bigint;
  bundleIds: string[];
};

/**
 * Result of executing a slot
 */
export type ExecutionResult = {
  transactionHash: string;
  bundleIds: string[];
  success: boolean;
  error?: string;
};
