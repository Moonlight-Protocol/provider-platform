import { ProcessEngine } from "@fifo/convee";
import { Buffer } from "buffer";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";
import { OperationsBundleRepository } from "@/persistence/drizzle/repository/operations-bundle.repository.ts";
import { SessionRepository } from "@/persistence/drizzle/repository/session.repository.ts";
import { UtxoRepository } from "@/persistence/drizzle/repository/utxo.repository.ts";
import { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CHANNEL_CLIENT } from "@/core/channel-client/index.ts";
import { TX_CONFIG, NETWORK_RPC_SERVER, OPEX_SK } from "@/config/env.ts";
import {
ChannelInvokeMethods,
  MoonlightOperation,
  MoonlightTransactionBuilder,
  type OperationTypes,
  sha256Hash,
  UtxoBasedStellarAccount,
  UTXOStatus,
} from "@moonlight/moonlight-sdk";
import { LOG } from "@/config/logger.ts";
import type { requestSchema } from "@/http/v1/bundle/post.ts";
import type { PostEndpointInput } from "@/http/pipelines/types.ts";
import type { SIM_ERRORS } from "@colibri/core";

const sessionRepository = new SessionRepository(drizzleClient);
const utxoRepository = new UtxoRepository(drizzleClient);
const operationsBundleRepository = new OperationsBundleRepository(drizzleClient);

export const P_AddOperationsBundle = ProcessEngine.create(
  async (input: PostEndpointInput<typeof requestSchema>) => {
    const operationsMLXDR = input.body.operationsMLXDR;
    const ctx = input.ctx;
    const sessionData = ctx.state.session as JwtSessionData;

    const userSession = await sessionRepository.findById(sessionData.sessionId);
    if (!userSession) {
      throw new Error("Invalid Session: Account not found in session");
    }

    const operationsBundleId = await sha256Hash(Buffer.from(JSON.stringify(operationsMLXDR)));

    const operationsBundle = await operationsBundleRepository.findById(operationsBundleId);
    if (operationsBundle && operationsBundle.status === BundleStatus.PENDING) {
      throw new Error("Invalid Operations Bundle: A PENDING Operations Bundle already exists");
    }

    const userOperations = await Promise.all(
      operationsMLXDR.map(async (xdr: string) => 
        await MoonlightOperation.fromMLXDR(xdr))
    );
    if (userOperations.length === 0) {
      throw new Error("Invalid Operations: No operations provided");
    }

    const createOperations = userOperations.filter((operation) => operation.isCreate());
    const spendOperations = userOperations.filter((operation) => operation.isSpend());
    const depositOperations = userOperations.filter((operation) => operation.isDeposit());
    const withdrawOperations = userOperations.filter((operation) => operation.isWithdraw());


    const newOperationsBundle = await operationsBundleRepository.create({
      id: operationsBundleId,
      status: BundleStatus.PENDING,
      ttl: new Date(Date.now() + 1000 * 60 * 60 * 24),
      createdBy: userSession.accountId,
      createdAt: new Date(),
    });

    const totalCreateAmount = createOperations.length > 0
      ? createOperations.reduce(
          (acc: bigint, operation: OperationTypes.CreateOperation) => {
            return acc + operation.getAmount();
          },
          BigInt(0)
        )
      : BigInt(0);
    const totalSpendAmount = spendOperations.length > 0
      ? spendOperations.reduce(
          (acc: bigint, operation: OperationTypes.SpendOperation) => {
            return acc + operation.getAmount();
          },
          BigInt(0)
        )
      : BigInt(0);
    const totalDepositAmount = depositOperations.length > 0
      ? depositOperations.reduce(
          (acc: bigint, operation: OperationTypes.DepositOperation) => {
            return acc + operation.getAmount();
          },
          BigInt(0)
        )
      : BigInt(0);

    const totalWithdrawAmount = withdrawOperations.length > 0
      ? withdrawOperations.reduce(
          (acc: bigint, operation: OperationTypes.WithdrawOperation) => {
            return acc + operation.getAmount();
          },
          BigInt(0)
        )
      : BigInt(0);

    const totalInflows = totalDepositAmount;
    const totalOutflows = totalCreateAmount + totalWithdrawAmount;
    let fee = totalInflows - totalOutflows;
    if (totalInflows <= BigInt(0)) {
      fee = totalSpendAmount - totalOutflows
    }

    LOG.debug("Fee calculation breakdown", {
      totalDepositAmount: totalDepositAmount.toString(),
      totalCreateAmount: totalCreateAmount.toString(),
      totalWithdrawAmount: totalWithdrawAmount.toString(),
      totalSpendAmount: totalSpendAmount.toString(),
      totalInflows: totalInflows.toString(),
      totalOutflows: totalOutflows.toString(),
      fee: fee.toString(),
    });

    if (fee < BigInt(1)) {
      LOG.warn("This bundle doesn't have any fee");
    }

    const txBuilder = MoonlightTransactionBuilder.fromPrivacyChannel(CHANNEL_CLIENT);

    const opexHandler = UtxoBasedStellarAccount.fromPrivacyChannel({
      channelClient: CHANNEL_CLIENT,
      root: OPEX_SK,
      options: {
        batchSize: 200,
      },
    });

    const nOfCreate = 1;
    while (opexHandler.getUTXOsByState(UTXOStatus.FREE).length < nOfCreate + 1) {
      LOG.trace("Deriving UTXOs batch for OPEX account");
      await opexHandler.deriveBatch({});
      LOG.trace("Loading UTXOs batch for OPEX account");
      await opexHandler.batchLoad();
      LOG.trace(`Derived UTXOS: ${opexHandler.getAllUTXOs().length}`);
      LOG.trace(
        `Free UTXOS: ${opexHandler.getUTXOsByState(UTXOStatus.FREE).length}`
      );
      LOG.trace(
        `Free SPENT: ${opexHandler.getUTXOsByState(UTXOStatus.SPENT).length}`
      );
      LOG.trace(
        `Free UNSPENT: ${opexHandler.getUTXOsByState(UTXOStatus.UNSPENT).length}`
      );
      LOG.trace(
        `Free UNLOADED: ${
          opexHandler.getUTXOsByState(UTXOStatus.UNLOADED).length
        }`
      );
    }

    const reservedUTXOs = opexHandler.reserveUTXOs(nOfCreate);
    if (reservedUTXOs === null) {
      throw new Error("Not enough UTXOs available to reserve for create");
    }
    const targetAmount = fee;

    const op = MoonlightOperation.create(reservedUTXOs[0].publicKey, targetAmount);
    txBuilder.addOperation(op);
    console.log("\n\n--------Operation", op.toMLXDR());

    const latestLedger = await NETWORK_RPC_SERVER.getLatestLedger()
    const expiration = latestLedger.sequence + 1000;

    depositOperations.forEach((operation: OperationTypes.DepositOperation) => {
      txBuilder.addOperation(operation as OperationTypes.DepositOperation);
    });

    for (const operation of createOperations) {
      await utxoRepository.create({
        id: Buffer.from(operation.getUtxo()).toString("base64"),
        accountId: userSession.accountId,
        amount: operation.getAmount(),
        createdAt: new Date(),
        createdBy: userSession.accountId,
        createdAtBundleId: newOperationsBundle.id,
      });

      txBuilder.addOperation(operation as OperationTypes.CreateOperation);
    }

    for (const operation of spendOperations) {
      if (!operation.isSignedByUTXO()) {
        throw new Error("Invalid Operations: Spend operation must be signed by UTXO owner");
      }
      
      const utxo = await utxoRepository.findById(operation.getUtxo().toString());
      if (!utxo) {
        throw new Error("Invalid Operations: UTXO not found");
      }
      await utxoRepository.update(utxo.id, {
        amount: utxo.amount - operation.getAmount(),
        updatedAt: new Date(),
        updatedBy: userSession.accountId,
        spentAtBundleId: newOperationsBundle.id,
        spentByAccountId: userSession.accountId
      });

      txBuilder.addOperation(operation as OperationTypes.SpendOperation);
    }

    await txBuilder.signWithProvider(TX_CONFIG.signers[1], expiration)

    try {
      const { hash } = await CHANNEL_CLIENT.invokeRaw({
        operationArgs: {
          function: ChannelInvokeMethods.transact,
          args: [txBuilder.buildXDR()],
          auth: [...txBuilder.getSignedAuthEntries()],
        },
        config: TX_CONFIG,
      }).catch((error) => {
        LOG.error("\n\n\n\Simulation failed", (error as SIM_ERRORS.SIMULATION_FAILED).meta.data.input.transaction.toXDR());
        Deno.exit(1);
      });

      await operationsBundleRepository.update(newOperationsBundle.id, {
        status: BundleStatus.COMPLETED,
        updatedAt: new Date(),
        updatedBy: userSession.accountId,
      });

      return {
        ctx: input.ctx,
        operationsBundleId: "blabalblabla",
        // operationsBundleId: newOperationsBundle.id,
        transactionHash: hash.toString(),
      }
    } catch (error) {
      LOG.error("Error submitting bundle to channel contract", error);
      throw error;
    }
  },
  {
    name: "ProcessNewBundleProcessEngine",
  }
);
