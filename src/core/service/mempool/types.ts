import type { OperationTypes } from "@moonlight/moonlight-sdk";
import type { OperationsBundle } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import type { Utxo } from "@/persistence/drizzle/entity/utxo.entity.ts";

/**
 * Represents a bundle item within a mempool slot
 * Contains all necessary data to construct and execute a transaction
 */
export type SlotItem = {
  bundleId: string;
  fee: bigint;
  createdAt: Date;
  ttl: Date;
  operationsMLXDR: string[];
  // Classified operations extracted from MLXDR
  operations: {
    deposit: OperationTypes.DepositOperation[];
    withdraw: OperationTypes.WithdrawOperation[];
    create: OperationTypes.CreateOperation[];
    spend: OperationTypes.SpendOperation[];
  };
  // UTXOs associated with this bundle
  utxos: {
    inputs: Utxo[]; // UTXOs being spent
    outputs: Utxo[]; // UTXOs being created
  };
};

/**
 * Represents an item in the mempool queue
 * Each item contains multiple slots that will be sent in a single transaction
 */
export type MempoolQueueItem = {
  id: string;
  slots: SlotItem[]; // Array of slots filled with bundles
  transactionId?: string; // Filled after execution
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  createdAt: Date;
  updatedAt: Date;
  processedAt?: Date;
};

/**
 * Result of attempting to add a bundle to a slot
 */
export type SlotAddResult = {
  inserted: boolean;
  displaced?: OperationsBundle; // Bundle that was displaced if insertion succeeded
  reason?: "TTL_EXPIRED" | "NO_CAPACITY" | "SUCCESS";
};

/**
 * Priority calculation result for bundle comparison
 */
export type BundlePriority = {
  fee: bigint;
  createdAt: Date;
  ttl: Date;
  score: number; // Calculated priority score (higher = more priority)
};

