import type { Logger } from "@/utils/logger/index.ts";

/** Authoritative membership verdict from the council's public endpoint. */
export type MembershipStatus = "ACTIVE" | "PENDING" | "NOT_FOUND" | "UNKNOWN";

/**
 * Ask a council whether `publicKey` is still an active provider. Mirrors the
 * council's `GET /api/v1/public/provider/membership-status` contract:
 *   200 → ACTIVE, 202 → PENDING, 404 → NOT_FOUND, anything else / error → UNKNOWN.
 * Best-effort: never throws so a flaky council can't wedge boot convergence
 * (the live event path remains the can't-miss baseline alongside this query).
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

export interface MembershipConvergeDeps {
  listPps(): Promise<Array<{ publicKey: string }>>;
  /** The PP's currently-ACTIVE membership, if any. */
  getActiveMembership(
    ppPublicKey: string,
  ): Promise<{ channelAuthId: string; councilUrl: string } | undefined>;
  /** Query the council for the authoritative membership verdict. */
  fetchStatus: typeof fetchMembershipStatus;
  /** Demote the PP's membership for a council to REJECTED (the watcher's path). */
  deactivate(ppPublicKey: string, channelAuthId: string): Promise<void>;
  log: Logger;
}

/**
 * Boot convergence-by-query for MEMBERSHIP (the sibling of channel-status boot
 * convergence). For every PP that still looks ACTIVE locally, ask its council
 * whether it is still a member; if the council authoritatively says NOT_FOUND
 * (404) — a `provider_removed` that may have landed while this provider was down
 * and fallen out of RPC retention — demote it via the same path the live
 * watcher uses. Pure / env-free so it is unit-testable; the watcher wires real
 * repos in. ACTIVE / PENDING / UNKNOWN are left untouched, so a transient
 * council error never knocks a valid membership offline.
 *
 * Returns the public keys demoted.
 */
export async function convergeMembershipStatusesOnBoot(
  deps: MembershipConvergeDeps,
): Promise<{ demoted: string[] }> {
  const log = deps.log.scope("convergeMemberships");
  const demoted: string[] = [];
  try {
    const pps = await deps.listPps();
    for (const pp of pps) {
      const membership = await deps.getActiveMembership(pp.publicKey);
      if (!membership?.channelAuthId) continue;
      const status = await deps.fetchStatus(
        membership.councilUrl,
        membership.channelAuthId,
        pp.publicKey,
      );
      if (status === "NOT_FOUND") {
        await deps.deactivate(pp.publicKey, membership.channelAuthId);
        demoted.push(pp.publicKey);
        log.event("membership demoted on boot (council reports removed)");
      }
    }
    log.debug("demoted", demoted.length);
    log.event("membership statuses converged from council queries");
  } catch (err) {
    log.error(err, "failed to converge membership statuses on boot");
  }
  return { demoted };
}
