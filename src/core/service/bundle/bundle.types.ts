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

/**
 * Configuration for calculating bundle weight
 */
export type WeightConfig = {
  expensiveOpWeight: number;
  cheapOpWeight: number;
};

/**
 * Bundle structure for mempool slot
 * Contains all necessary information for slot management and priority calculation
 */
export type SlotBundle = {
  bundleId: string;
  channelContractId: string;
  operationsMLXDR: string[];
  operations: ClassifiedOperations;
  fee: bigint;
  weight: number;
  ttl: Date;
  createdAt: Date;
  priorityScore: number;
  retryCount: number;
  lastFailureReason?: string | null;
};

/**
 * Priority score type (numeric value for comparison)
 */
export type PriorityScore = number;
