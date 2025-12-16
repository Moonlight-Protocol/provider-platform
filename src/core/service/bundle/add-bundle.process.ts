import { ProcessEngine } from "@fifo/convee";
import { Buffer } from "buffer";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";
import { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CHANNEL_CLIENT } from "@/core/channel-client/index.ts";
import { TX_CONFIG, NETWORK_RPC_SERVER, OPEX_SK } from "@/config/env.ts";
import {
  ChannelInvokeMethods,
  MoonlightOperation,
  MoonlightTransactionBuilder,
  type OperationTypes,
  UtxoBasedStellarAccount,
  UTXOStatus,
} from "@moonlight/moonlight-sdk";
import { LOG } from "@/config/logger.ts";
import type { requestSchema } from "@/http/v1/bundle/post.ts";
import type { PostEndpointInput } from "@/http/pipelines/types.ts";
import type { SIM_ERRORS } from "@colibri/core";
import {
  classifyOperations,
  calculateOperationAmounts,
  calculateFee,
  generateBundleId,
  calculateBundleTtl,
} from "@/core/service/bundle/bundle.service.ts";
import * as E from "@/core/service/bundle/bundle.errors.ts";
import type { ClassifiedOperations } from "@/core/service/bundle/bundle.types.ts";
import { logAndThrow } from "@/utils/error/log-and-throw.ts";
import type { OperationsBundle } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import { TransactionStatus } from "@/persistence/drizzle/entity/transaction.entity.ts";
import { 
  OperationsBundleRepository,
  SessionRepository,
  UtxoRepository,
  TransactionRepository,
  BundleTransactionRepository,
} from "@/persistence/drizzle/repository/index.ts";

// Configuration constants
const BUNDLE_CONFIG = {
  TTL_HOURS: 24,
  OPEX_UTXO_BATCH_SIZE: 200,
  REQUIRED_OPEX_UTXOS: 1,
  TRANSACTION_EXPIRATION_OFFSET: 1000,
} as const;

// Repositories
const sessionRepository = new SessionRepository(drizzleClient);
const utxoRepository = new UtxoRepository(drizzleClient);
const operationsBundleRepository = new OperationsBundleRepository(drizzleClient);
const transactionRepository = new TransactionRepository();
const bundleTransactionRepository = new BundleTransactionRepository();

// ========== HELPER FUNCTIONS ==========

/**
 * Validates the user session
 */
async function validateSession(sessionId: string) {
  const userSession = await sessionRepository.findById(sessionId);
  if (!userSession) {
    logAndThrow(new E.INVALID_SESSION(sessionId));
  }
  return userSession;
}

/**
 * Validates that exists and the bundle is expired with the same ID, otherwise throws an error
 */
async function assertBundleIsNotExpired(bundleId: string): Promise<boolean> {
  const existingBundle = await operationsBundleRepository.findById(bundleId);

  if (!existingBundle)
    return false;

  if (existingBundle.status !== BundleStatus.EXPIRED)
    logAndThrow(new E.BUNDLE_ALREADY_EXISTS(bundleId));
  
  return true;
}

/**
 * Parses MLXDR operations
 */
async function parseOperations(operationsMLXDR: string[]): Promise<Array<OperationTypes.CreateOperation | OperationTypes.SpendOperation | OperationTypes.DepositOperation | OperationTypes.WithdrawOperation>> {
  const operations = await Promise.all(
    operationsMLXDR.map((xdr) => MoonlightOperation.fromMLXDR(xdr))
  );
  
  if (operations.length === 0) {
    logAndThrow(new E.NO_OPERATIONS_PROVIDED());
  }
  
  return operations;
}

/**
 * Validates spend operations
 */
function validateSpendOperations(operations: OperationTypes.SpendOperation[]): void {
  for (let i = 0; i < operations.length; i++) {
    const operation = operations[i];
    if (!operation.isSignedByUTXO()) {
      logAndThrow(new E.SPEND_OPERATION_NOT_SIGNED(i));
    }
  }
}

/**
 * Ensures OPEX account has enough free UTXOs available
 */
async function ensureOpexUtxosAvailable(
  opexHandler: UtxoBasedStellarAccount,
  requiredCount: number
): Promise<void> {
  while (opexHandler.getUTXOsByState(UTXOStatus.FREE).length < requiredCount + 1) {
    LOG.trace("Deriving UTXOs batch for OPEX account");
    await opexHandler.deriveBatch({});
    LOG.trace("Loading UTXOs batch for OPEX account");
    await opexHandler.batchLoad();
    
    LOG.trace(`Derived UTXOS: ${opexHandler.getAllUTXOs().length}`);
    LOG.trace(`Free UTXOS: ${opexHandler.getUTXOsByState(UTXOStatus.FREE).length}`);
    LOG.trace(`SPENT: ${opexHandler.getUTXOsByState(UTXOStatus.SPENT).length}`);
    LOG.trace(`UNSPENT: ${opexHandler.getUTXOsByState(UTXOStatus.UNSPENT).length}`);
    LOG.trace(`UNLOADED: ${opexHandler.getUTXOsByState(UTXOStatus.UNLOADED).length}`);
  }
}

/**
 * Persists UTXOs in the database from create operations
 */
async function persistCreateOperations(
  operations: OperationTypes.CreateOperation[],
  bundleId: string,
  accountId: string
): Promise<void> {
  for (const operation of operations) {
    const utxoId = Buffer.from(operation.getUtxo()).toString("base64");
    const utxo = await utxoRepository.findById(utxoId);
    if (utxo) {
      continue;
    }

    await utxoRepository.create({
      id: utxoId,
      accountId,
      amount: operation.getAmount(),
      createdAt: new Date(),
      createdBy: accountId,
      createdAtBundleId: bundleId,
    });
  }
}

/**
 * Updates UTXOs in the database from spend operations
 */
async function persistSpendOperations(
  operations: OperationTypes.SpendOperation[],
  bundleId: string,
  accountId: string
): Promise<void> {
  for (const operation of operations) {
    const utxoId = operation.getUtxo().toString();
    const utxo = await utxoRepository.findById(utxoId);
    
    if (!utxo) {
      logAndThrow(new E.UTXO_NOT_FOUND(utxoId));
    }
    
    await utxoRepository.update(utxo.id, {
      amount: utxo.amount - operation.getAmount(),
      updatedAt: new Date(),
      updatedBy: accountId,
      spentAtBundleId: bundleId,
      spentByAccountId: accountId,
    });
  }
}

/**
 * Adds operations to the transaction builder
 */
function addOperationsToTransaction(
  txBuilder: MoonlightTransactionBuilder,
  classified: ClassifiedOperations
): void {
  classified.deposit.forEach((op) => {
    txBuilder.addOperation(op);
  });
  
  classified.create.forEach((op) => {
    txBuilder.addOperation(op);
  });
  
  classified.spend.forEach((op) => {
    txBuilder.addOperation(op);
  });
}

/**
 * Gets transaction expiration from latest ledger
 */
async function getTransactionExpiration(): Promise<number> {
  const latestLedger = await NETWORK_RPC_SERVER.getLatestLedger();
  return latestLedger.sequence + BUNDLE_CONFIG.TRANSACTION_EXPIRATION_OFFSET;
}

/**
 * Submits transaction to channel contract
 */
async function submitTransaction(
  txBuilder: MoonlightTransactionBuilder,
  expiration: number
): Promise<string> {
  await txBuilder.signWithProvider(TX_CONFIG.signers[1], expiration);
  
  try {
    const { hash } = await CHANNEL_CLIENT.invokeRaw({
      operationArgs: {
        function: ChannelInvokeMethods.transact,
        args: [txBuilder.buildXDR()],
        auth: [...txBuilder.getSignedAuthEntries()],
      },
      config: TX_CONFIG,
    });
    
    return hash.toString();
  } catch (error) {
    LOG.error("Simulation failed: ", (error as SIM_ERRORS.SIMULATION_FAILED).meta.data.input.transaction.toXDR());
    logAndThrow(new E.INVALID_OPERATIONS("Simulation failed"));
  }
}

// ========== MAIN PROCESS ==========

export const P_AddOperationsBundle = ProcessEngine.create(
  async (input: PostEndpointInput<typeof requestSchema>) => {
    const { operationsMLXDR } = input.body;
    const sessionData = input.ctx.state.session as JwtSessionData;

    // 1. Session validation
    const userSession = await validateSession(sessionData.sessionId);

    // 2. Bundle ID generation and validation
    const bundleId = await generateBundleId(operationsMLXDR);
    const isBundleExpired = await assertBundleIsNotExpired(bundleId);

    // 3. Parse and classify operations
    const operations = await parseOperations(operationsMLXDR);
    const classified = classifyOperations(operations);
    validateSpendOperations(classified.spend);
      
    // 4. Bundle update or creation
    let bundleEntity: OperationsBundle;
    if (isBundleExpired) {
      bundleEntity = await operationsBundleRepository.update(bundleId, {
        status: BundleStatus.PENDING,
        updatedAt: new Date(),
        updatedBy: userSession.accountId,
      });
    } else {
      bundleEntity = await operationsBundleRepository.create({
        id: bundleId,
        status: BundleStatus.PENDING,
        ttl: calculateBundleTtl(),
        createdBy: userSession.accountId,
        createdAt: new Date(),
      });
    }
    

    // 5. Fee calculation
    const amounts = calculateOperationAmounts(classified);
    const feeCalculation = calculateFee(amounts);
    
    LOG.debug("Fee calculation breakdown", {
      totalDepositAmount: feeCalculation.breakdown.totalDepositAmount.toString(),
      totalCreateAmount: feeCalculation.breakdown.totalCreateAmount.toString(),
      totalWithdrawAmount: feeCalculation.breakdown.totalWithdrawAmount.toString(),
      totalSpendAmount: feeCalculation.breakdown.totalSpendAmount.toString(),
      totalInflows: feeCalculation.totalInflows.toString(),
      totalOutflows: feeCalculation.totalOutflows.toString(),
      fee: feeCalculation.fee.toString(),
    });

    if (feeCalculation.fee < BigInt(1)) {
      LOG.warn("This bundle doesn't have any fee");
    }

    // 6. Setup transaction builder and OPEX handler
    const txBuilder = MoonlightTransactionBuilder.fromPrivacyChannel(CHANNEL_CLIENT);
    const opexHandler = UtxoBasedStellarAccount.fromPrivacyChannel({
      channelClient: CHANNEL_CLIENT,
      root: OPEX_SK,
      options: {
        batchSize: BUNDLE_CONFIG.OPEX_UTXO_BATCH_SIZE,
      },
    });

    // 7. OPEX UTXO management
    await ensureOpexUtxosAvailable(opexHandler, BUNDLE_CONFIG.REQUIRED_OPEX_UTXOS);
    const reservedUtxos = opexHandler.reserveUTXOs(BUNDLE_CONFIG.REQUIRED_OPEX_UTXOS);
    
    if (!reservedUtxos) {
      const availableCount = opexHandler.getUTXOsByState(UTXOStatus.FREE).length;
      logAndThrow(new E.INSUFFICIENT_UTXOS(BUNDLE_CONFIG.REQUIRED_OPEX_UTXOS, availableCount));
    }

    // 8. Create fee operation
    const feeOperation = MoonlightOperation.create(
      reservedUtxos[0].publicKey,
      feeCalculation.fee
    );
    txBuilder.addOperation(feeOperation);
    LOG.debug("Fee operation created", { mlxdr: feeOperation.toMLXDR() });

    // 9. Get expiration and add operations to transaction
    const expiration = await getTransactionExpiration();
    addOperationsToTransaction(txBuilder, classified);

    // 10. Persist UTXOs
    await persistCreateOperations(classified.create, bundleEntity.id, userSession.accountId);
    await persistSpendOperations(classified.spend, bundleEntity.id, userSession.accountId);

    // 11. Submit transaction
    const transactionHash = await submitTransaction(txBuilder, expiration);

    // 12. Persist the transaction and vinculate it to the bundle
    await transactionRepository.create({
      id: transactionHash,
      status: TransactionStatus.VERIFIED,
      timeout: new Date(Date.now() + BUNDLE_CONFIG.TRANSACTION_EXPIRATION_OFFSET),
      ledgerSequence: (await (NETWORK_RPC_SERVER.getLatestLedger())).sequence.toString(),
      createdAt: new Date(),
      createdBy: userSession.accountId,
    });

    await bundleTransactionRepository.create({
      transactionId: transactionHash,
      bundleId: bundleEntity.id,
      createdAt: new Date(),
      createdBy: userSession.accountId,
    });

    // 13. Update bundle status
    await operationsBundleRepository.update(bundleEntity.id, {
      status: BundleStatus.COMPLETED,
      updatedAt: new Date(),
      updatedBy: userSession.accountId,
    });

    return {
      ctx: input.ctx,
      operationsBundleId: bundleEntity.id,
      transactionHash,
    };
  },
  {
    name: "ProcessNewBundleProcessEngine",
  }
);
