/**
 * Pre-flight OpEx fee check.
 *
 * Runs before bundle submission: simulates the Soroban tx the executor is
 * about to submit, then checks the PP root account (the Stellar fee payer)
 * has enough XLM to cover (base inclusion fee + min Soroban resource fee)
 * after subtracting the minimum reserve. If not, throws
 * `InsufficientFees` with structured detail — the submit-orchestration
 * layer catches that specifically and moves the bundle to terminal-FAILED
 * without entering the retry loop.
 *
 * Why this lives outside `submitTransactionToNetwork`: the check needs the
 * un-signed transaction to simulate (Soroban sim does not require auth
 * entries), so it is naturally a step that runs after build but before
 * sign+submit.
 */
import type { MoonlightTransactionBuilder } from "@moonlight/moonlight-sdk";
import {
  Account as StellarAccount,
  Keypair,
  Operation,
  TransactionBuilder,
  xdr,
} from "stellar-sdk";
import { Api as RpcApi, type Server } from "stellar-sdk/rpc";
import { withSpan } from "@/core/tracing.ts";
import {
  InsufficientFees,
  type InsufficientFeesDetail,
} from "@/core/service/executor/executor.errors.ts";
import type { Logger } from "@/utils/logger/index.ts";

export interface PreflightOpexDeps {
  rpcServer: Pick<Server, "getLedgerEntries" | "simulateTransaction">;
  networkPassphrase: string;
  /** Base inclusion fee, in stroops, applied to the outer transaction. */
  baseInclusionFeeStroops: bigint;
  /** `(2 + numSubEntries) * BASE_RESERVE_STROOPS` reserve unit, in stroops. */
  baseReserveStroops: bigint;
  log: Logger;
}

/** Output of the math, useful for tests and for the failure detail payload. */
export type PreflightResult = {
  feePayerPubkey: string;
  availableXlmStroops: bigint;
  requiredXlmStroops: bigint;
  /** Negative when sufficient; positive when shortfall. */
  shortfallStroops: bigint;
};

/**
 * Compute `available = balance - (2 + numSubEntries) * baseReserve`
 * and `required = baseInclusionFee + minResourceFee`, returning the
 * shortfall (positive when under-funded).
 *
 * Pure function — broken out so the math is unit-testable without RPC mocks.
 */
export function computePreflightResult(args: {
  feePayerPubkey: string;
  balanceStroops: bigint;
  numSubEntries: bigint;
  baseReserveStroops: bigint;
  baseInclusionFeeStroops: bigint;
  minResourceFeeStroops: bigint;
}): PreflightResult {
  const reserveStroops = (BigInt(2) + args.numSubEntries) *
    args.baseReserveStroops;
  const availableXlmStroops = args.balanceStroops - reserveStroops;
  const requiredXlmStroops = args.baseInclusionFeeStroops +
    args.minResourceFeeStroops;
  const shortfallStroops = requiredXlmStroops - availableXlmStroops;
  return {
    feePayerPubkey: args.feePayerPubkey,
    availableXlmStroops,
    requiredXlmStroops,
    shortfallStroops,
  };
}

/** Encode a PreflightResult into the persisted/serialised detail shape. */
export function toInsufficientFeesDetail(
  result: PreflightResult,
): InsufficientFeesDetail {
  return {
    feePayerPubkey: result.feePayerPubkey,
    availableXlm: result.availableXlmStroops.toString(),
    requiredXlm: result.requiredXlmStroops.toString(),
    shortfallXlm: result.shortfallStroops.toString(),
  };
}

function readAccountEntry(
  entries: ReadonlyArray<{ val: xdr.LedgerEntryData }>,
): { balanceStroops: bigint; numSubEntries: bigint } | null {
  for (const e of entries) {
    if (e.val.switch().name !== "account") continue;
    const acct = e.val.account();
    return {
      balanceStroops: BigInt(acct.balance().toString()),
      numSubEntries: BigInt(acct.numSubEntries()),
    };
  }
  return null;
}

/**
 * Fetches the fee-payer's XLM balance and subentry count via Soroban RPC's
 * `getLedgerEntries`. Returns `null` if the account is missing entirely
 * (not yet funded), in which case the caller treats it as zero balance.
 */
export async function fetchFeePayerAccountState(
  feePayerPubkey: string,
  rpcServer: Pick<Server, "getLedgerEntries">,
): Promise<{ balanceStroops: bigint; numSubEntries: bigint } | null> {
  const accountKey = xdr.LedgerKey.account(
    new xdr.LedgerKeyAccount({
      accountId: Keypair.fromPublicKey(feePayerPubkey).xdrAccountId(),
    }),
  );
  const result = await rpcServer.getLedgerEntries(accountKey);
  if (!result.entries || result.entries.length === 0) return null;
  return readAccountEntry(result.entries);
}

/**
 * Simulates the channel-invoke transaction the executor is about to submit,
 * extracting `minResourceFee` (the Soroban resource portion). The simulation
 * is run with an un-signed contract-call operation; Soroban does not require
 * auth entries for fee estimation.
 */
export async function simulateBundleResourceFee(args: {
  txBuilder: MoonlightTransactionBuilder;
  feePayerPubkey: string;
  feePayerSequence: bigint;
  networkPassphrase: string;
  baseInclusionFeeStroops: bigint;
  rpcServer: Pick<Server, "simulateTransaction">;
}): Promise<bigint> {
  const sourceAccount = new StellarAccount(
    args.feePayerPubkey,
    args.feePayerSequence.toString(),
  );

  const invokeOp = Operation.invokeContractFunction({
    contract: args.txBuilder.getChannelId(),
    function: "transact",
    args: [args.txBuilder.buildXDR()],
    auth: [],
  });

  const tx = new TransactionBuilder(sourceAccount, {
    fee: args.baseInclusionFeeStroops.toString(),
    networkPassphrase: args.networkPassphrase,
  })
    .addOperation(invokeOp)
    .setTimeout(30)
    .build();

  const sim = await args.rpcServer.simulateTransaction(tx);
  if (RpcApi.isSimulationError(sim)) {
    throw new Error(`simulateTransaction returned error: ${sim.error}`);
  }
  if (!("minResourceFee" in sim) || !sim.minResourceFee) {
    throw new Error("simulateTransaction did not return minResourceFee");
  }
  return BigInt(sim.minResourceFee);
}

/**
 * End-to-end pre-flight check. Throws `InsufficientFees` if the fee payer
 * cannot cover (inclusion + Soroban-resource) fee after reserves.
 */
export async function runPreflightOpexFeeCheck(
  args: {
    txBuilder: MoonlightTransactionBuilder;
    feePayerPubkey: string;
  },
  deps: PreflightOpexDeps,
): Promise<PreflightResult> {
  return await withSpan("Executor.preflightOpexFeeCheck", async (span) => {
    const log = deps.log.scope("preflightOpexFeeCheck");
    span.setAttribute("fee_payer.pubkey", args.feePayerPubkey);
    log.event("fetching fee-payer account state");

    const accountState = await fetchFeePayerAccountState(
      args.feePayerPubkey,
      deps.rpcServer,
    );

    const balanceStroops = accountState?.balanceStroops ?? BigInt(0);
    const numSubEntries = accountState?.numSubEntries ?? BigInt(0);
    span.setAttribute("fee_payer.balance_stroops", balanceStroops.toString());
    span.setAttribute("fee_payer.num_sub_entries", numSubEntries.toString());

    log.event("simulating transaction for resource-fee estimate");
    const sourceAcct = await deps.rpcServer.getLedgerEntries(
      xdr.LedgerKey.account(
        new xdr.LedgerKeyAccount({
          accountId: Keypair.fromPublicKey(args.feePayerPubkey).xdrAccountId(),
        }),
      ),
    );
    // Sequence is irrelevant for sim correctness; use 0 if the account is
    // missing or its sequence cannot be read. simulateTransaction does not
    // execute the tx — it returns resource estimates only.
    let feePayerSequence = BigInt(0);
    if (sourceAcct.entries && sourceAcct.entries[0]) {
      const accountEntry = sourceAcct.entries[0].val.account();
      feePayerSequence = BigInt(accountEntry.seqNum().toString());
    }

    const minResourceFeeStroops = await simulateBundleResourceFee({
      txBuilder: args.txBuilder,
      feePayerPubkey: args.feePayerPubkey,
      feePayerSequence,
      networkPassphrase: deps.networkPassphrase,
      baseInclusionFeeStroops: deps.baseInclusionFeeStroops,
      rpcServer: deps.rpcServer,
    });
    span.setAttribute(
      "fee_payer.min_resource_fee_stroops",
      minResourceFeeStroops.toString(),
    );

    const result = computePreflightResult({
      feePayerPubkey: args.feePayerPubkey,
      balanceStroops,
      numSubEntries,
      baseReserveStroops: deps.baseReserveStroops,
      baseInclusionFeeStroops: deps.baseInclusionFeeStroops,
      minResourceFeeStroops,
    });
    span.setAttribute(
      "fee_payer.required_stroops",
      result.requiredXlmStroops.toString(),
    );
    span.setAttribute(
      "fee_payer.available_stroops",
      result.availableXlmStroops.toString(),
    );
    span.setAttribute(
      "fee_payer.shortfall_stroops",
      result.shortfallStroops.toString(),
    );

    if (result.shortfallStroops > BigInt(0)) {
      span.addEvent("preflight_insufficient_fees");
      log.event("pre-flight check failed: insufficient fees");
      throw new InsufficientFees(toInsufficientFeesDetail(result));
    }

    span.addEvent("preflight_ok");
    log.event("pre-flight check passed");
    return result;
  });
}
