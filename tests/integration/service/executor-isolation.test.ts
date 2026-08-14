import { assertEquals, assertExists } from "@std/assert";
import {
  ensureInitialized,
  getBundleRepo,
  resetDb,
  seedBundle,
  testBundleId,
} from "../../test_helpers.ts";
import {
  type BundleProbeResult,
  handleSlotFailureWithIsolation,
} from "@/core/service/executor/bundle-isolation.ts";
import { expireSlotBundlesPastTtl } from "@/core/service/executor/executor-failure.helpers.ts";
import { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import type { SlotBundle } from "@/core/service/bundle/bundle.types.ts";
import { newNoop } from "@/utils/logger/index.ts";

async function setup() {
  await ensureInitialized();
  await resetDb();
  return getBundleRepo();
}

function makeSlotBundle(
  bundleId: string,
  overrides: Partial<SlotBundle> = {},
): SlotBundle {
  return {
    bundleId,
    channelContractId: "CCHANNEL",
    operationsMLXDR: [],
    operations: { create: [], spend: [], deposit: [], withdraw: [] },
    fee: BigInt(100),
    weight: 1,
    ttl: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    priorityScore: 1,
    retryCount: 0,
    lastFailureReason: null,
    ppPublicKey: "GPP",
    entityName: null,
    jurisdictions: [],
    amount: null,
    ...overrides,
  };
}

function probeFromVerdicts(
  verdicts: Record<string, BundleProbeResult["verdict"]>,
) {
  return (bundle: SlotBundle): Promise<BundleProbeResult> =>
    Promise.resolve({
      bundleId: bundle.bundleId,
      verdict: verdicts[bundle.bundleId],
      error: verdicts[bundle.bundleId] === "invalid"
        ? new Error("Amount too low: -23000000")
        : undefined,
    });
}

// ---------------------------------------------------------------------------
// handleSlotFailureWithIsolation
// ---------------------------------------------------------------------------

Deno.test(
  "isolation – offender FAILED with failureDetail, innocents PENDING and re-queued",
  async () => {
    const repo = await setup();
    const offenderId = testBundleId();
    const innocentId = testBundleId();
    await seedBundle({ id: offenderId, status: BundleStatus.PROCESSING });
    await seedBundle({ id: innocentId, status: BundleStatus.PROCESSING });

    const bundles = [makeSlotBundle(offenderId), makeSlotBundle(innocentId)];
    const reAdded: SlotBundle[] = [];

    const handled = await handleSlotFailureWithIsolation(bundles, {
      probe: probeFromVerdicts({
        [offenderId]: "invalid",
        [innocentId]: "valid",
      }),
      operationsBundleRepository: repo,
      reAddBundles: (b) => {
        reAdded.push(...b);
        return Promise.resolve();
      },
      log: newNoop(),
    });

    assertEquals(handled, true);

    const offender = await repo.findById(offenderId);
    assertExists(offender);
    assertEquals(offender.status, BundleStatus.FAILED);
    assertEquals(offender.retryCount, 1);
    assertExists(offender.failureDetail);
    assertExists(offender.lastFailureReason);
    assertEquals(
      JSON.parse(offender.lastFailureReason!).phase,
      "bundleIsolation",
    );

    const innocent = await repo.findById(innocentId);
    assertExists(innocent);
    assertEquals(innocent.status, BundleStatus.PENDING);
    // Innocents are not charged a retry for a failure that was not theirs.
    assertEquals(innocent.retryCount, 0);

    assertEquals(reAdded.length, 1);
    assertEquals(reAdded[0].bundleId, innocentId);
  },
);

Deno.test(
  "isolation – any inconclusive probe falls back (nothing persisted, not handled)",
  async () => {
    const repo = await setup();
    const idA = testBundleId();
    const idB = testBundleId();
    await seedBundle({ id: idA, status: BundleStatus.PROCESSING });
    await seedBundle({ id: idB, status: BundleStatus.PROCESSING });

    const handled = await handleSlotFailureWithIsolation(
      [makeSlotBundle(idA), makeSlotBundle(idB)],
      {
        probe: probeFromVerdicts({ [idA]: "invalid", [idB]: "inconclusive" }),
        operationsBundleRepository: repo,
        reAddBundles: () => Promise.resolve(),
        log: newNoop(),
      },
    );

    assertEquals(handled, false);
    const a = await repo.findById(idA);
    const b = await repo.findById(idB);
    assertEquals(a?.status, BundleStatus.PROCESSING);
    assertEquals(b?.status, BundleStatus.PROCESSING);
  },
);

Deno.test(
  "isolation – no offender found falls back to the group path",
  async () => {
    const repo = await setup();
    const idA = testBundleId();
    const idB = testBundleId();
    await seedBundle({ id: idA, status: BundleStatus.PROCESSING });
    await seedBundle({ id: idB, status: BundleStatus.PROCESSING });

    const handled = await handleSlotFailureWithIsolation(
      [makeSlotBundle(idA), makeSlotBundle(idB)],
      {
        probe: probeFromVerdicts({ [idA]: "valid", [idB]: "valid" }),
        operationsBundleRepository: repo,
        reAddBundles: () => Promise.resolve(),
        log: newNoop(),
      },
    );

    assertEquals(handled, false);
  },
);

Deno.test(
  "isolation – single-bundle slot is not probed (caller falls back)",
  async () => {
    const repo = await setup();
    const id = testBundleId();
    await seedBundle({ id, status: BundleStatus.PROCESSING });

    let probed = 0;
    const handled = await handleSlotFailureWithIsolation([makeSlotBundle(id)], {
      probe: (bundle) => {
        probed++;
        return Promise.resolve({
          bundleId: bundle.bundleId,
          verdict: "invalid" as const,
        });
      },
      operationsBundleRepository: repo,
      reAddBundles: () => Promise.resolve(),
      log: newNoop(),
    });

    assertEquals(handled, false);
    assertEquals(probed, 0);
  },
);

Deno.test(
  "isolation – innocent concurrently EXPIRED keeps EXPIRED and is not re-queued",
  async () => {
    const repo = await setup();
    const offenderId = testBundleId();
    const expiredId = testBundleId();
    await seedBundle({ id: offenderId, status: BundleStatus.PROCESSING });
    await seedBundle({ id: expiredId, status: BundleStatus.EXPIRED });

    const reAdded: SlotBundle[] = [];
    const handled = await handleSlotFailureWithIsolation(
      [makeSlotBundle(offenderId), makeSlotBundle(expiredId)],
      {
        probe: probeFromVerdicts({
          [offenderId]: "invalid",
          [expiredId]: "valid",
        }),
        operationsBundleRepository: repo,
        reAddBundles: (b) => {
          reAdded.push(...b);
          return Promise.resolve();
        },
        log: newNoop(),
      },
    );

    assertEquals(handled, true);
    const expired = await repo.findById(expiredId);
    assertEquals(expired?.status, BundleStatus.EXPIRED);
    assertEquals(reAdded.length, 0);
  },
);

// ---------------------------------------------------------------------------
// expireSlotBundlesPastTtl
// ---------------------------------------------------------------------------

function makeFakeSlot(bundles: SlotBundle[]) {
  const store = [...bundles];
  return {
    getBundles: () => [...store],
    removeBundle: (bundleId: string) => {
      const idx = store.findIndex((b) => b.bundleId === bundleId);
      if (idx === -1) return false;
      store.splice(idx, 1);
      return true;
    },
    isEmpty: () => store.length === 0,
  };
}

Deno.test(
  "ttl gate – expired bundle is evicted from the slot and marked EXPIRED",
  async () => {
    const repo = await setup();
    const expiredId = testBundleId();
    const freshId = testBundleId();
    await seedBundle({ id: expiredId, status: BundleStatus.PROCESSING });
    await seedBundle({ id: freshId, status: BundleStatus.PROCESSING });

    const past = new Date(Date.now() - 3_600_000);
    const slot = makeFakeSlot([
      makeSlotBundle(expiredId, { ttl: past }),
      makeSlotBundle(freshId),
    ]);
    const emitted: string[] = [];

    const evicted = await expireSlotBundlesPastTtl(slot, {
      operationsBundleRepository: repo,
      isExpired: (b) => b.ttl.getTime() <= Date.now(),
      emitExpired: (b) => {
        emitted.push(b.bundleId);
        return Promise.resolve();
      },
      log: newNoop(),
    });

    assertEquals(evicted.map((b) => b.bundleId), [expiredId]);
    assertEquals(slot.getBundles().map((b) => b.bundleId), [freshId]);
    assertEquals(emitted, [expiredId]);

    const expired = await repo.findById(expiredId);
    const fresh = await repo.findById(freshId);
    assertEquals(expired?.status, BundleStatus.EXPIRED);
    assertEquals(fresh?.status, BundleStatus.PROCESSING);
  },
);

Deno.test(
  "ttl gate – bundle already EXPIRED in DB is still evicted without a status change",
  async () => {
    const repo = await setup();
    const id = testBundleId();
    // send-loop's force-expire writes EXPIRED directly while the bundle is
    // still in an in-memory slot; the gate must evict it and leave EXPIRED.
    await seedBundle({ id, status: BundleStatus.EXPIRED });

    const slot = makeFakeSlot([
      makeSlotBundle(id, { ttl: new Date(Date.now() - 1000) }),
    ]);

    const evicted = await expireSlotBundlesPastTtl(slot, {
      operationsBundleRepository: repo,
      isExpired: () => true,
      emitExpired: () => Promise.resolve(),
      log: newNoop(),
    });

    assertEquals(evicted.length, 1);
    assertEquals(slot.isEmpty(), true);
    const found = await repo.findById(id);
    assertEquals(found?.status, BundleStatus.EXPIRED);
  },
);
