import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  ensureInitialized,
  resetDb,
  seedBundle,
  testBundleId,
  getBundleRepo,
} from "../../test_helpers.ts";
import { handleExecutionFailure } from "@/core/service/executor/executor-failure.helpers.ts";
import { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";

const MAX_RETRY = 3;

async function setup() {
  await ensureInitialized();
  await resetDb();
  return getBundleRepo();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeError(msg = "simulated error") {
  return new Error(msg);
}

function makeLastFailureReason(error: Error, bundleId: string): string {
  return JSON.stringify({
    occurredAt: new Date().toISOString(),
    phase: "slotExecution",
    error: {
      name: error.name,
      message: error.message,
    },
    bundleIds: [bundleId],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test(
  "executor – below max retries: status→PENDING, retryCount incremented, reAddBundles called",
  async () => {
    const repo = await setup();
    const id = testBundleId();
    await seedBundle({ id, retryCount: 1, status: BundleStatus.PROCESSING });

    const error = makeError();
    const reason = makeLastFailureReason(error, id);

    const retryMeta = await handleExecutionFailure(error, [id], reason, {
      operationsBundleRepository: repo,
      maxRetryAttempts: MAX_RETRY,
    });

    // The bundle should be returned for retry
    assertEquals(retryMeta.length, 1);
    assertEquals(retryMeta[0].bundleId, id);
    assertEquals(retryMeta[0].nextRetryCount, 2);

    // Persisted state
    const found = await repo.findById(id);
    assertExists(found);
    assertEquals(found.status, BundleStatus.PENDING);
    assertEquals(found.retryCount, 2);
    assertExists(found.lastFailureReason);
  },
);

Deno.test(
  "executor – at max retries (dead-letter): status→FAILED, retryCount=MAX, NOT returned for retry",
  async () => {
    const repo = await setup();
    const id = testBundleId();
    await seedBundle({ id, retryCount: 2, status: BundleStatus.PROCESSING });

    const error = makeError();
    const reason = makeLastFailureReason(error, id);

    const retryMeta = await handleExecutionFailure(error, [id], reason, {
      operationsBundleRepository: repo,
      maxRetryAttempts: MAX_RETRY,
    });

    // Should NOT be returned for retry
    assertEquals(retryMeta.length, 0);

    // Persisted state
    const found = await repo.findById(id);
    assertExists(found);
    assertEquals(found.status, BundleStatus.FAILED);
    assertEquals(found.retryCount, 3);
    assertExists(found.lastFailureReason);
  },
);

Deno.test(
  "executor – multiple bundles in slot: only eligible bundle returned for retry",
  async () => {
    const repo = await setup();
    const eligibleId = testBundleId();
    const deadLetterId = testBundleId();

    // Below max
    await seedBundle({ id: eligibleId, retryCount: 1, status: BundleStatus.PROCESSING });
    // At max
    await seedBundle({ id: deadLetterId, retryCount: 2, status: BundleStatus.PROCESSING });

    const error = makeError("multi-bundle failure");
    const reason = JSON.stringify({
      occurredAt: new Date().toISOString(),
      phase: "slotExecution",
      error: { message: error.message },
    });

    const retryMeta = await handleExecutionFailure(
      error,
      [eligibleId, deadLetterId],
      reason,
      { operationsBundleRepository: repo, maxRetryAttempts: MAX_RETRY },
    );

    assertEquals(retryMeta.length, 1);
    assertEquals(retryMeta[0].bundleId, eligibleId);

    const eligible = await repo.findById(eligibleId);
    const deadLetter = await repo.findById(deadLetterId);

    assertExists(eligible);
    assertExists(deadLetter);
    assertEquals(eligible.status, BundleStatus.PENDING);
    assertEquals(deadLetter.status, BundleStatus.FAILED);
  },
);

Deno.test(
  "executor – lastFailureReason has occurredAt, phase, and error.message",
  async () => {
    const repo = await setup();
    const id = testBundleId();
    await seedBundle({ id, retryCount: 0 });

    const error = makeError("timeout connecting to RPC");
    const reason = JSON.stringify({
      occurredAt: new Date().toISOString(),
      phase: "slotExecution",
      error: { name: error.name, message: error.message },
      bundleIds: [id],
    });

    await handleExecutionFailure(error, [id], reason, {
      operationsBundleRepository: repo,
      maxRetryAttempts: MAX_RETRY,
    });

    const found = await repo.findById(id);
    assertExists(found);
    assertExists(found.lastFailureReason);

    const parsed = JSON.parse(found.lastFailureReason!);
    assertExists(parsed.occurredAt);
    assertEquals(typeof parsed.occurredAt, "string");
    assertExists(parsed.phase);
    assertExists(parsed.error);
    assertExists(parsed.error.message);
    assertEquals(parsed.error.message, "timeout connecting to RPC");
  },
);

Deno.test(
  "executor – retryCount starts at 0: first failure yields retryCount=1",
  async () => {
    const repo = await setup();
    const id = testBundleId();
    await seedBundle({ id, retryCount: 0 });

    const error = makeError();
    const reason = makeLastFailureReason(error, id);

    const meta = await handleExecutionFailure(error, [id], reason, {
      operationsBundleRepository: repo,
      maxRetryAttempts: MAX_RETRY,
    });

    assertEquals(meta.length, 1);
    assertEquals(meta[0].nextRetryCount, 1);

    const found = await repo.findById(id);
    assertExists(found);
    assertEquals(found.retryCount, 1);
    assertEquals(found.status, BundleStatus.PENDING);
  },
);

Deno.test(
  "executor – missing bundle is skipped gracefully (no error thrown)",
  async () => {
    const repo = await setup();
    const missingId = "non-existent-bundle-id";
    const error = makeError();
    const reason = makeLastFailureReason(error, missingId);

    // Should not throw
    const meta = await handleExecutionFailure(error, [missingId], reason, {
      operationsBundleRepository: repo,
      maxRetryAttempts: MAX_RETRY,
    });

    assertEquals(meta.length, 0);
  },
);
