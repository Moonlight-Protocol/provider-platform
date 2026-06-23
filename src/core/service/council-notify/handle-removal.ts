import type { Logger } from "@/utils/logger/index.ts";
import {
  type CouncilMembership,
  CouncilMembershipStatus,
} from "@/persistence/drizzle/entity/council-membership.entity.ts";

/** Authoritative membership verdict from the council's public endpoint. */
export type MembershipStatus = "ACTIVE" | "PENDING" | "NOT_FOUND" | "UNKNOWN";

/**
 * Ask a council whether `publicKey` is still an active provider. Mirrors the
 * council's `GET /api/v1/public/provider/membership-status` contract:
 *   200 → ACTIVE, 202 → PENDING, 404 → NOT_FOUND, anything else / error → UNKNOWN.
 * Best-effort: never throws so a flaky council can't wedge the notice handler
 * (the watcher remains the can't-miss path).
 */
export async function fetchMembershipStatus(
  councilUrl: string,
  channelAuthId: string,
  publicKey: string,
): Promise<MembershipStatus> {
  try {
    const base = councilUrl.replace(/\/+$/, "");
    const res = await fetch(
      `${base}/api/v1/public/provider/membership-status?councilId=${
        encodeURIComponent(channelAuthId)
      }&publicKey=${encodeURIComponent(publicKey)}`,
    );
    if (res.status === 200) return "ACTIVE";
    if (res.status === 202) return "PENDING";
    if (res.status === 404) return "NOT_FOUND";
    return "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}

export interface RemovalNoticeDeps {
  ppRepo: { listAll(): Promise<Array<{ publicKey: string }>> };
  membershipRepo: {
    getCurrentForPp(
      ppPublicKey: string,
    ): Promise<CouncilMembership | undefined>;
    update(
      id: string,
      fields: { status: CouncilMembershipStatus },
    ): Promise<unknown>;
  };
  log: Logger;
  /** Injectable for tests; defaults to the real council query. */
  fetchStatus?: typeof fetchMembershipStatus;
}

/**
 * Handle a council "you were removed" notice for `channelAuthId`.
 *
 * The notice is NOT trusted on its own: for every PP that currently holds an
 * ACTIVE membership in that council, we re-query the council's authoritative
 * membership-status endpoint and demote to REJECTED only when the council
 * confirms NOT_FOUND. ACTIVE / PENDING / UNKNOWN are left untouched, so a forged
 * or stale notice — or a transient council error — can never knock a still-valid
 * membership offline. The PP's own on-chain event-watcher remains the
 * can't-miss path; this just reacts immediately instead of on the next poll.
 *
 * Returns the public keys that were demoted.
 */
export async function handleCouncilRemovalNotice(
  channelAuthId: string,
  deps: RemovalNoticeDeps,
): Promise<{ deactivated: string[] }> {
  const fetchStatus = deps.fetchStatus ?? fetchMembershipStatus;
  const log = deps.log.scope("councilRemovalNotice");
  const deactivated: string[] = [];

  const pps = await deps.ppRepo.listAll();
  for (const pp of pps) {
    const membership = await deps.membershipRepo.getCurrentForPp(pp.publicKey);
    if (!membership || membership.channelAuthId !== channelAuthId) continue;
    if (membership.status !== CouncilMembershipStatus.ACTIVE) continue;

    const status = await fetchStatus(
      membership.councilUrl,
      channelAuthId,
      pp.publicKey,
    );
    if (status === "NOT_FOUND") {
      await deps.membershipRepo.update(membership.id, {
        status: CouncilMembershipStatus.REJECTED,
      });
      deactivated.push(pp.publicKey);
      log.event("PP membership deactivated via council removal notice");
    }
  }

  return { deactivated };
}
