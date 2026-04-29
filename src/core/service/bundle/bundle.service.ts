import { Buffer } from "buffer";
import type {
  MoonlightOperation,
  PrivacyChannel,
} from "@moonlight/moonlight-sdk";
import {
  ChannelReadMethods,
  type OperationTypes,
  sha256Hash,
  type UTXOPublicKey,
} from "@moonlight/moonlight-sdk";
import type {
  ClassifiedOperations,
  FeeCalculation,
  OperationAmounts,
} from "@/core/service/bundle/bundle.types.ts";
import type { OperationsBundle } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";

/**
 * Classifies operations by type
 *
 * @param operations - List of Moonlight operations
 * @returns Operations classified by type
 */
export function classifyOperations(
  operations: Array<
    | OperationTypes.CreateOperation
    | OperationTypes.SpendOperation
    | OperationTypes.DepositOperation
    | OperationTypes.WithdrawOperation
  >,
): ClassifiedOperations {
  return {
    create: operations.filter((op) =>
      op.isCreate()
    ) as OperationTypes.CreateOperation[],
    spend: operations.filter((op) =>
      op.isSpend()
    ) as OperationTypes.SpendOperation[],
    deposit: operations.filter((op) =>
      op.isDeposit()
    ) as OperationTypes.DepositOperation[],
    withdraw: operations.filter((op) =>
      op.isWithdraw()
    ) as OperationTypes.WithdrawOperation[],
  };
}

/**
 * Fetches the balance of one or more UTXOs directly from the network
 *
 * @param utxoPublicKeys - Array of UTXO public keys
 * @returns Array of balances corresponding to each UTXO (in bigint)
 */
export async function fetchUtxoBalances(
  utxoPublicKeys: UTXOPublicKey[],
  channelClient: PrivacyChannel,
): Promise<bigint[]> {
  if (utxoPublicKeys.length === 0) {
    return [];
  }

  const result = await channelClient.read({
    method: ChannelReadMethods.utxo_balances,
    methodArgs: {
      utxos: utxoPublicKeys.map((u) => Buffer.from(u)),
    },
  });

  // The result is an array of balances, convert to bigint
  return (result as Array<string | number | bigint>).map((balance) =>
    BigInt(balance)
  );
}

/**
 * Fetches the balance of a single UTXO
 *
 * @param utxoPublicKey - UTXO public key
 * @returns Balance of the UTXO (in bigint)
 */
export async function fetchUtxoBalance(
  utxoPublicKey: UTXOPublicKey,
  channelClient: PrivacyChannel,
): Promise<bigint> {
  const balances = await fetchUtxoBalances([utxoPublicKey], channelClient);
  return balances[0] || BigInt(0);
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
  getAmount: (op: T) => bigint,
): bigint {
  return operations.reduce((acc, op) => acc + getAmount(op), BigInt(0));
}

/**
 * Calculates the totals for each operation type
 *
 * Note: For spend operations, the amount is fetched directly from the network
 * since SpendOperation intentionally does not have an amount attribute.
 *
 * @param classified - Classified operations
 * @returns Breakdown of amounts by operation type
 */
export async function calculateOperationAmounts(
  classified: ClassifiedOperations,
  channelClient: PrivacyChannel,
): Promise<OperationAmounts> {
  // Fetch spend operation amounts from the network
  const spendUtxos = classified.spend.map((op) => op.getUtxo());
  const spendBalances = await fetchUtxoBalances(spendUtxos, channelClient);

  const totalSpendAmount = spendBalances.reduce(
    (acc, balance) => acc + balance,
    BigInt(0),
  );

  return {
    totalCreateAmount: classified.create.reduce(
      (acc, op) => acc + op.getAmount(),
      BigInt(0),
    ),
    totalSpendAmount,
    totalDepositAmount: classified.deposit.reduce(
      (acc, op) => acc + op.getAmount(),
      BigInt(0),
    ),
    totalWithdrawAmount: classified.withdraw.reduce(
      (acc, op) => acc + op.getAmount(),
      BigInt(0),
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
  const totalOutflows = breakdown.totalCreateAmount +
    breakdown.totalWithdrawAmount;

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
export async function generateBundleId(
  operationsMLXDR: string[],
): Promise<string> {
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

/**
 * Bundle DTO shape for API responses
 */
export type BundleDTO = {
  id: string;
  status: string;
  ttl: string;
  operationsMLXDR: string[];
  fee: string;
  createdAt: string;
  updatedAt: string | null;
};

/**
 * Converts OperationsBundle entity to DTO for API responses
 *
 * @param bundle - OperationsBundle entity
 * @returns Bundle DTO with ISO date strings
 */
export function toBundleDTO(bundle: OperationsBundle): BundleDTO {
  return {
    id: bundle.id,
    status: bundle.status,
    ttl: bundle.ttl.toISOString(),
    operationsMLXDR: bundle.operationsMLXDR,
    fee: bundle.fee.toString(),
    createdAt: bundle.createdAt.toISOString(),
    updatedAt: bundle.updatedAt ? bundle.updatedAt.toISOString() : null,
  };
}

/**
 * Calculates the weight of a bundle based on operation types
 * Expensive operations (spend, withdraw) have higher weight than cheap operations (deposit, create)
 *
 * @param classified - Classified operations
 * @param config - Weight configuration with expensive and cheap operation weights
 * @returns Total weight of the bundle
 */
export function calculateBundleWeight(
  classified: ClassifiedOperations,
  config: { expensiveOpWeight: number; cheapOpWeight: number },
): number {
  const expensiveOpsCount = classified.spend.length +
    classified.withdraw.length;
  const cheapOpsCount = classified.deposit.length + classified.create.length;

  return (expensiveOpsCount * config.expensiveOpWeight) +
    (cheapOpsCount * config.cheapOpWeight);
}

/**
 * Calculates the priority score of a bundle for slot allocation
 * Higher score means higher priority
 *
 * Priority factors (in order of importance):
 * 1. Fee (higher fee = higher priority)
 * 2. Creation time (older = higher priority)
 * 3. TTL proximity (closer to expiration = higher priority)
 *
 * @param bundle - Slot bundle with fee, ttl, and createdAt
 * @returns Priority score (higher = more priority)
 */
export function calculatePriorityScore(bundle: {
  fee: bigint;
  ttl: Date;
  createdAt: Date;
}): number {
  const now = Date.now();
  const ttlTime = bundle.ttl.getTime();
  const createdAtTime = bundle.createdAt.getTime();

  // Normalize fee to a score (using log to prevent very large fees from dominating)
  // Convert bigint to number for calculation (assuming fees are within safe number range)
  const feeScore = Number(bundle.fee) / 1_000_000; // Normalize by dividing by 1M

  // Age: older bundles get higher priority
  // Calculate age in hours, normalize (older = higher score)
  const ageHours = (now - createdAtTime) / (1000 * 60 * 60);
  const ageScore = Math.min(ageHours / 24, 1.0); // Cap at 1.0 for bundles older than 24h

  // TTL proximity: closer to expiration = higher priority
  // Calculate time remaining in milliseconds, convert to hours for normalization
  const timeRemainingMs = ttlTime - now;
  const timeRemainingHours = Math.max(0, timeRemainingMs / (1000 * 60 * 60));
  // Inverse: less time remaining = higher score (max 24 hours = 1.0, 0 hours = 24.0)
  const ttlScore = timeRemainingHours > 0 ? 24 / (timeRemainingHours + 1) : 24;

  // Weighted combination: fee (60%), age (30%), TTL (10%)
  return (feeScore * 0.6) + (ageScore * 0.3) + (ttlScore * 0.1);
}
