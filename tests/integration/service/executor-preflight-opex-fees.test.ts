import { assertEquals, assertExists, assertRejects } from "@std/assert";
import {
  ensureInitialized,
  getBundleRepo,
  resetDb,
  seedBundle,
  testBundleId,
} from "../../test_helpers.ts";
import { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import {
  InsufficientFees,
  type InsufficientFeesDetail,
} from "@/core/service/executor/executor.errors.ts";
import { runPreflightOpexFeeCheck } from "@/core/service/executor/preflight-opex-balance.ts";
import { toBundleDTO } from "@/core/service/bundle/bundle.service.ts";
import { responseSchema as bundleGetResponseSchema } from "@/http/v1/bundle/get.ts";
import { Keypair, Networks, StrKey, xdr } from "stellar-sdk";
import { Buffer } from "buffer";
import type { MoonlightTransactionBuilder } from "@moonlight/moonlight-sdk";

const STUB_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 0x01));

const STUB_LOG = {
  scope: () => STUB_LOG,
  info: () => {},
  debug: () => {},
  event: () => {},
  error: () => {},
} as unknown as Parameters<typeof runPreflightOpexFeeCheck>[1]["log"];

// ---------------------------------------------------------------------------
// Helpers — RPC + txBuilder doubles
// ---------------------------------------------------------------------------

/** Returns a stub Soroban-RPC server that yields a fixed account balance,
 *  subentry count, and `minResourceFee` from simulateTransaction. */
function makeStubRpc(opts: {
  balanceStroops: bigint;
  numSubEntries: bigint;
  minResourceFee: string;
  /** When true, getLedgerEntries returns no entries (account not funded). */
  accountMissing?: boolean;
}) {
  const accountEntry = xdr.LedgerEntryData.account(
    new xdr.AccountEntry({
      accountId: Keypair.random().xdrAccountId(),
      balance: xdr.Int64.fromString(opts.balanceStroops.toString()),
      seqNum: xdr.SequenceNumber.fromString("1"),
      numSubEntries: Number(opts.numSubEntries),
      inflationDest: null,
      flags: 0,
      homeDomain: "",
      thresholds: Buffer.from([1, 0, 0, 0]),
      signers: [],
      ext: new xdr.AccountEntryExt(0),
    }),
  );

  return {
    getLedgerEntries: (_key: xdr.LedgerKey) => {
      if (opts.accountMissing) {
        return Promise.resolve({ latestLedger: 1, entries: [] });
      }
      return Promise.resolve({
        latestLedger: 1,
        entries: [
          {
            lastModifiedLedgerSeq: 1,
            key: _key,
            val: accountEntry,
          },
        ],
      });
    },
    simulateTransaction: (_tx: unknown) =>
      Promise.resolve({
        minResourceFee: opts.minResourceFee,
        transactionData: "",
        events: [],
        results: [],
        cost: { cpuInsns: "0", memBytes: "0" },
        latestLedger: 1,
      }),
  } as unknown as Parameters<typeof runPreflightOpexFeeCheck>[1]["rpcServer"];
}

/** A minimal `MoonlightTransactionBuilder` shim covering only the two
 *  methods `runPreflightOpexFeeCheck` calls. */
function makeStubTxBuilder(
  channelContractId: string,
): MoonlightTransactionBuilder {
  return {
    getChannelId: () => channelContractId,
    buildXDR: () => xdr.ScVal.scvMap([]),
  } as unknown as MoonlightTransactionBuilder;
}

const FEE_PAYER_PUBKEY = Keypair.random().publicKey();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test(
  "preflight — under-funded fee payer: throws InsufficientFees with all four structured fields",
  async () => {
    await ensureInitialized();

    const rpc = makeStubRpc({
      balanceStroops: BigInt(10_000_300), // 1.0000300 XLM
      numSubEntries: BigInt(2), // reserves = (2+2) * 5M = 20M
      minResourceFee: "1000",
    });
    const txBuilder = makeStubTxBuilder(
      STUB_CONTRACT_ID,
    );

    const err = await assertRejects(
      () =>
        runPreflightOpexFeeCheck(
          { txBuilder, feePayerPubkey: FEE_PAYER_PUBKEY },
          {
            rpcServer: rpc,
            networkPassphrase: Networks.TESTNET,
            baseInclusionFeeStroops: BigInt(100),
            baseReserveStroops: BigInt(5_000_000),
            log: STUB_LOG,
          },
        ),
      InsufficientFees,
    );

    const detail = (err as InsufficientFees).detail;
    assertEquals(detail.feePayerPubkey, FEE_PAYER_PUBKEY);
    // available = 10_000_300 - 20_000_000 = -9_999_700
    assertEquals(detail.availableXlm, "-9999700");
    // required = 100 + 1000 = 1100
    assertEquals(detail.requiredXlm, "1100");
    // shortfall = 1100 - (-9_999_700) = 10_000_800
    assertEquals(detail.shortfallXlm, "10000800");
  },
);

Deno.test(
  "preflight — sufficient balance: returns the result without throwing",
  async () => {
    await ensureInitialized();

    // balance = 100 XLM, 0 subentries → reserves = 10M, available = 990M
    // required = 100 + 1000 = 1100 → shortfall = -989999900 (huge surplus)
    const rpc = makeStubRpc({
      balanceStroops: BigInt(1_000_000_000),
      numSubEntries: BigInt(0),
      minResourceFee: "1000",
    });
    const txBuilder = makeStubTxBuilder(
      STUB_CONTRACT_ID,
    );

    const result = await runPreflightOpexFeeCheck(
      { txBuilder, feePayerPubkey: FEE_PAYER_PUBKEY },
      {
        rpcServer: rpc,
        networkPassphrase: Networks.TESTNET,
        baseInclusionFeeStroops: BigInt(100),
        baseReserveStroops: BigInt(5_000_000),
        log: STUB_LOG,
      },
    );
    assertEquals(result.shortfallStroops < BigInt(0), true);
  },
);

Deno.test(
  "preflight — unfunded fee payer (account missing): treated as zero balance, throws InsufficientFees",
  async () => {
    await ensureInitialized();

    const rpc = makeStubRpc({
      balanceStroops: BigInt(0),
      numSubEntries: BigInt(0),
      minResourceFee: "1000",
      accountMissing: true,
    });
    const txBuilder = makeStubTxBuilder(
      STUB_CONTRACT_ID,
    );

    await assertRejects(
      () =>
        runPreflightOpexFeeCheck(
          { txBuilder, feePayerPubkey: FEE_PAYER_PUBKEY },
          {
            rpcServer: rpc,
            networkPassphrase: Networks.TESTNET,
            baseInclusionFeeStroops: BigInt(100),
            baseReserveStroops: BigInt(5_000_000),
            log: STUB_LOG,
          },
        ),
      InsufficientFees,
    );
  },
);

Deno.test(
  "catch-site terminal-fail — persists FAILED with structured detail and does NOT increment retryCount",
  async () => {
    await ensureInitialized();
    await resetDb();
    const repo = getBundleRepo();
    const bundleId = testBundleId();
    await seedBundle({
      id: bundleId,
      retryCount: 2, // already retried twice; pre-flight must NOT increment
      status: BundleStatus.PROCESSING,
    });

    // Construct the typed error as the pre-flight would
    const detail: InsufficientFeesDetail = {
      feePayerPubkey: FEE_PAYER_PUBKEY,
      availableXlm: "-9999700",
      requiredXlm: "1100",
      shortfallXlm: "10000800",
    };
    const error = new InsufficientFees(detail);

    // Mimic the executor catch-site fast-path (executor.process.ts) exactly:
    // status=FAILED, persist failureDetail, keep retryCount unchanged, do NOT
    // pass through handleExecutionFailure.
    await repo.update(bundleId, {
      status: BundleStatus.FAILED,
      lastFailureReason: error.message,
      failureDetail: { ...error.detail },
      updatedAt: new Date(),
    });

    const reloaded = await repo.findById(bundleId);
    assertExists(reloaded);
    assertEquals(reloaded.status, BundleStatus.FAILED);
    assertEquals(reloaded.retryCount, 2, "retryCount must NOT be incremented");
    assertExists(reloaded.failureDetail);
    assertEquals(
      (reloaded.failureDetail as InsufficientFeesDetail).feePayerPubkey,
      FEE_PAYER_PUBKEY,
    );
    assertEquals(
      (reloaded.failureDetail as InsufficientFeesDetail).availableXlm,
      "-9999700",
    );
    assertEquals(
      (reloaded.failureDetail as InsufficientFeesDetail).requiredXlm,
      "1100",
    );
    assertEquals(
      (reloaded.failureDetail as InsufficientFeesDetail).shortfallXlm,
      "10000800",
    );
  },
);

Deno.test(
  "bundle-status API surfacing — DTO carries failureDetail and parses against responseSchema",
  async () => {
    await ensureInitialized();
    await resetDb();
    const repo = getBundleRepo();
    const bundleId = testBundleId();
    await seedBundle({ id: bundleId, status: BundleStatus.PROCESSING });

    const detail: InsufficientFeesDetail = {
      feePayerPubkey: FEE_PAYER_PUBKEY,
      availableXlm: "0",
      requiredXlm: "1100",
      shortfallXlm: "1100",
    };
    await repo.update(bundleId, {
      status: BundleStatus.FAILED,
      lastFailureReason: "Insufficient fees on fee-payer account",
      failureDetail: { ...detail },
      updatedAt: new Date(),
    });

    const persisted = await repo.findById(bundleId);
    assertExists(persisted);
    const dto = toBundleDTO(persisted);

    // The new field is on the DTO and the existing API response schema accepts it.
    const parsed = bundleGetResponseSchema.parse(dto);
    assertExists(parsed.failureDetail);
    assertEquals(
      (parsed.failureDetail as InsufficientFeesDetail).feePayerPubkey,
      FEE_PAYER_PUBKEY,
    );
    assertEquals(
      (parsed.failureDetail as InsufficientFeesDetail).availableXlm,
      "0",
    );
    assertEquals(
      (parsed.failureDetail as InsufficientFeesDetail).requiredXlm,
      "1100",
    );
    assertEquals(
      (parsed.failureDetail as InsufficientFeesDetail).shortfallXlm,
      "1100",
    );
  },
);

Deno.test(
  "bundle-status API surfacing — failureDetail is null for non-failed bundles (back-compat)",
  async () => {
    await ensureInitialized();
    await resetDb();
    const repo = getBundleRepo();
    const bundleId = testBundleId();
    await seedBundle({ id: bundleId, status: BundleStatus.PENDING });
    const bundle = await repo.findById(bundleId);
    assertExists(bundle);
    const dto = toBundleDTO(bundle);
    assertEquals(dto.failureDetail, null);
    const parsed = bundleGetResponseSchema.parse(dto);
    assertEquals(parsed.failureDetail, null);
  },
);
