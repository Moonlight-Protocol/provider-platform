import type { ChannelRegistry } from "./channel-registry.ts";
import type { Logger } from "@/utils/logger/index.ts";

/**
 * Subset of a council's public state (`GET /api/v1/public/council`) the provider
 * needs to converge asset-channel statuses.
 */
export interface CouncilConfigData {
  council?: { name?: string; channelAuthId?: string };
  channels?: Array<{ channelContractId?: string; status?: string }>;
}

/**
 * Query a council's current public state. Best-effort: returns null on any
 * network/HTTP/parse error so callers degrade gracefully (the live event path
 * still applies deltas; this query is the can't-miss baseline).
 */
export async function fetchCouncilConfig(
  councilUrl: string,
  channelAuthId: string,
  deps?: { log?: Logger },
): Promise<CouncilConfigData | null> {
  try {
    const res = await fetch(
      `${councilUrl}/api/v1/public/council?councilId=${
        encodeURIComponent(channelAuthId)
      }`,
    );
    if (!res.ok) {
      // Best-effort still, but no longer silent (#10): a persistently failing
      // council query degrades convergence and must be visible.
      deps?.log?.error(
        new Error(`council config query returned ${res.status}`),
        "fetchCouncilConfig non-OK response",
        { councilUrl, channelAuthId, status: res.status },
      );
      return null;
    }
    const { data } = await res.json();
    return data as CouncilConfigData;
  } catch (error) {
    deps?.log?.error(error, "fetchCouncilConfig failed", {
      councilUrl,
      channelAuthId,
    });
    return null;
  }
}

/**
 * Reconcile the registry's asset-channel statuses against a council config —
 * the "converge by querying the council" behavior used on boot and on
 * out-of-retention recovery. A channel with status "disabled" becomes
 * withdraw-only; anything else (or a missing status, for backward
 * compatibility) is full service. Channels absent from the config are left
 * untouched (the gate fails open for unknown channels).
 */
export async function reconcileChannelStatuses(
  registry: ChannelRegistry,
  data: CouncilConfigData,
): Promise<void> {
  for (const ch of data.channels ?? []) {
    if (!ch?.channelContractId) continue;
    await registry.applyChannelState(
      ch.channelContractId,
      ch.status !== "disabled",
    );
  }
}
