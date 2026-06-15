import { type Context, Status } from "@oak/oak";
import { channelRegistry } from "@/core/service/event-watcher/index.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilMembershipRepository } from "@/persistence/drizzle/repository/council-membership.repository.ts";
import type { PaymentProvider } from "@/persistence/drizzle/entity/pp.entity.ts";
import type { Logger } from "@/utils/logger/index.ts";

const membershipRepo = new CouncilMembershipRepository(drizzleClient);

/**
 * GET /api/v1/providers/:ppPublicKey/channels
 *
 * Returns the channels this PP participates in. The registry is the
 * platform-wide event-watcher view, so we cross-reference with this PP's
 * council memberships and only surface channels that belong to them.
 */
export function handleGetChannels(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("getChannels");

  return async (ctx) => {
    log.info("getChannels");
    const pp = ctx.state.pp as PaymentProvider;

    log.event("loading memberships for PP");
    const memberships = await membershipRepo.listAllForPp(pp.publicKey);
    const ppChannelIds = new Set<string>();
    for (const m of memberships) {
      if (!m.configJson) continue;
      try {
        const cfg = JSON.parse(m.configJson) as {
          channels?: Array<{ channelContractId: string }>;
        };
        for (const ch of cfg.channels ?? []) {
          if (ch.channelContractId) ppChannelIds.add(ch.channelContractId);
        }
      } catch {
        // ignore malformed config
      }
    }

    log.event("reading channel registry");
    const allChannels = channelRegistry.getAll();
    const channels = allChannels.filter((c) => ppChannelIds.has(c.contractId));
    log.debug("ppChannelCount", channels.length);

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Channels retrieved",
      data: {
        channels,
        summary: {
          total: channels.length,
          active: channels.filter((c) => c.state === "active").length,
          pending: channels.filter((c) => c.state === "pending").length,
          inactive: channels.filter((c) => c.state === "inactive").length,
          disabled: channels.filter((c) => c.state === "disabled").length,
        },
      },
    };
    log.event("channels response assembled");
  };
}
