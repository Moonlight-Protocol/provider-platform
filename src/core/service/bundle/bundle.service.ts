import { Buffer } from "buffer";
import type { MoonlightOperation } from "@moonlight/moonlight-sdk";
import { sha256Hash, type OperationTypes } from "@moonlight/moonlight-sdk";
import type { ClassifiedOperations, FeeCalculation, OperationAmounts } from "@/core/service/bundle/bundle.types.ts";

/**
 * Classifies operations by type
 * 
 * @param operations - List of Moonlight operations
 * @returns Operations classified by type
 */
export function classifyOperations(
  operations: Array<OperationTypes.CreateOperation | OperationTypes.SpendOperation | OperationTypes.DepositOperation | OperationTypes.WithdrawOperation>
): ClassifiedOperations {
  return {
    create: operations.filter((op) => op.isCreate()) as OperationTypes.CreateOperation[],
    spend: operations.filter((op) => op.isSpend()) as OperationTypes.SpendOperation[],
    deposit: operations.filter((op) => op.isDeposit()) as OperationTypes.DepositOperation[],
    withdraw: operations.filter((op) => op.isWithdraw()) as OperationTypes.WithdrawOperation[],
  };
}

/**
 * Calculates the total of a list of operations (DRY)
 * 
 * @param operations - List of operations
 * @param getAmount - Function to extract the value from each operation
 * @returns Calculated total
 */
export function calculateOperationsTotal<T extends MoonlightOperation>(
  operations: T[],
  getAmount: (op: T) => bigint
): bigint {
  return operations.reduce((acc, op) => acc + getAmount(op), BigInt(0));
}

/**
 * Calculates the totals for each operation type
 * 
 * @param classified - Classified operations
 * @returns Breakdown of amounts by operation type
 */
export function calculateOperationAmounts(
  classified: ClassifiedOperations
): OperationAmounts {
  return {
    totalCreateAmount: classified.create.reduce(
      (acc, op) => acc + op.getAmount(),
      BigInt(0)
    ),
    totalSpendAmount: classified.spend.reduce(
      (acc, op) => acc + op.getAmount(),
      BigInt(0)
    ),
    totalDepositAmount: classified.deposit.reduce(
      (acc, op) => acc + op.getAmount(),
      BigInt(0)
    ),
    totalWithdrawAmount: classified.withdraw.reduce(
      (acc, op) => acc + op.getAmount(),
      BigInt(0)
    ),
  };
}

/**
 * Calculates the bundle fee based on operations
 * 
 * @param breakdown - Breakdown of totals by operation type
 * @returns Complete fee calculation including breakdown
 */
export function calculateFee(breakdown: OperationAmounts): FeeCalculation {
  const totalInflows = breakdown.totalDepositAmount;
  const totalOutflows = breakdown.totalCreateAmount + breakdown.totalWithdrawAmount;
  
  let fee: bigint;
  if (totalInflows <= BigInt(0)) {
    fee = breakdown.totalSpendAmount - totalOutflows;
  } else {
    fee = totalInflows - totalOutflows;
  }

  return {
    fee,
    totalInflows,
    totalOutflows,
    breakdown,
  };
}

/**
 * Generates bundle ID from operations MLXDR
 * 
 * @param operationsMLXDR - Array of operation MLXDR strings
 * @returns Generated bundle ID
 */
export async function generateBundleId(operationsMLXDR: string[]): Promise<string> {
  return await sha256Hash(Buffer.from(JSON.stringify(operationsMLXDR)));
}

/**
 * Calculates bundle TTL (24 hours from now)
 * 
 * @returns TTL date
 */
export function calculateBundleTtl(): Date {
  return new Date(Date.now() + 1000 * 60 * 60 * 24);
}

