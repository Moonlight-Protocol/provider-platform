import type { OperationTypes } from "@moonlight/moonlight-sdk";

/**
 * Operations classified by type
 */
export type ClassifiedOperations = {
  create: OperationTypes.CreateOperation[];
  spend: OperationTypes.SpendOperation[];
  deposit: OperationTypes.DepositOperation[];
  withdraw: OperationTypes.WithdrawOperation[];
};

/**
 * Breakdown of operation amounts by type
 */
export type OperationAmounts = {
  totalDepositAmount: bigint;
  totalCreateAmount: bigint;
  totalWithdrawAmount: bigint;
  totalSpendAmount: bigint;
};

/**
 * Complete fee calculation result
 */
export type FeeCalculation = {
  fee: bigint;
  totalInflows: bigint;
  totalOutflows: bigint;
  breakdown: OperationAmounts;
};

