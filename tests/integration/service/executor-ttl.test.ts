import { assertEquals } from "@std/assert";
import {
  ensureInitialized,
  getBundleRepo,
  resetDb,
  seedBundle,
  testBundleId,
} from "../../test_helpers.ts";
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
  "ttl gate – bundle force-expired in DB only (fresh in-memory TTL) is still evicted",
  async () => {
    const repo = await setup();
    const id = testBundleId();
    // send-loop's force-expire writes EXPIRED directly to the row; the
    // in-memory SlotBundle keeps its original future TTL, so only the DB
    // status betrays the expiry. The gate must evict it and leave EXPIRED.
    await seedBundle({ id, status: BundleStatus.EXPIRED });

    const slot = makeFakeSlot([
      makeSlotBundle(id, { ttl: new Date(Date.now() + 60_000) }),
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

    assertEquals(evicted.length, 1);
    assertEquals(slot.isEmpty(), true);
    // Already terminal: no event, no status change.
    assertEquals(emitted, []);
    const found = await repo.findById(id);
    assertEquals(found?.status, BundleStatus.EXPIRED);
  },
);

Deno.test(
  "ttl gate – active bundle with fresh TTL stays in the slot",
  async () => {
    const repo = await setup();
    const id = testBundleId();
    await seedBundle({ id, status: BundleStatus.PROCESSING });

    const slot = makeFakeSlot([makeSlotBundle(id)]);

    const evicted = await expireSlotBundlesPastTtl(slot, {
      operationsBundleRepository: repo,
      isExpired: (b) => b.ttl.getTime() <= Date.now(),
      emitExpired: () => Promise.resolve(),
      log: newNoop(),
    });

    assertEquals(evicted.length, 0);
    assertEquals(slot.getBundles().length, 1);
    const found = await repo.findById(id);
    assertEquals(found?.status, BundleStatus.PROCESSING);
  },
);
