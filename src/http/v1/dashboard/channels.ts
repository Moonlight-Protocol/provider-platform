import { type Context, Status } from "@oak/oak";
import { channelRegistry } from "@/core/service/event-watcher/index.ts";
import type { Logger } from "@/utils/logger/index.ts";

/**
 * GET /dashboard/channels
 *
 * Returns all channels this PP is registered in, with their current state.
 * States: active (registered + configured), pending (registered, not configured),
 * inactive (removed on-chain).
 */
export function handleGetChannels(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("getChannels");

  return (ctx) => {
    log.info("getChannels");

    log.event("reading channel registry");
    const channels = channelRegistry.getAll();
    log.debug("channelCount", channels.length);

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
        },
      },
    };
    log.event("channels response assembled");
    return Promise.resolve();
  };
}
