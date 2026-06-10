import postgres from "postgres";
import type { Logger } from "@/utils/logger/index.ts";
import { DATABASE_URL } from "@/config/env.ts";
import type { ProviderEvent } from "@/core/service/events/event.types.ts";
import {
  type PgNotifyEventBus,
  PROVIDER_EVENTS_CHANNEL,
} from "@/core/service/events/pg-notify-event-bus.ts";

/**
 * Long-lived task that holds a dedicated `LISTEN provider_events` connection
 * and republishes incoming notifications to the local in-process bus.
 *
 * One pgListener runs per provider-platform machine. With this in place,
 * `getEventBus().emit()` on any machine reaches subscribers (WS handlers) on
 * every machine — bundles processed on machine A deliver to WS clients held
 * on machine B without sticky-session routing.
 *
 * Reconnect: the `postgres` driver's built-in `sql.listen` manages reserved
 * connection re-subscription with its own backoff on network drops. The
 * `onlisten` callback fires after every (re-)subscription so we log every
 * recovery. Start-from-now semantics: notifications during a disconnect
 * window are not buffered. Subscribers that need backfill are expected to
 * implement it themselves (out of scope here).
 */
export async function startPgListener(deps: {
  log: Logger;
  bus: PgNotifyEventBus;
}): Promise<() => Promise<void>> {
  const log = deps.log.scope("pgListener");
  log.info("startPgListener");
  log.event("starting pgListener");

  // Dedicated connection — postgres LISTEN reserves it for the lifetime of
  // the subscription, so it must not come from the drizzle query pool.
  const sql = postgres(DATABASE_URL, { max: 1 });

  const onNotify = (payload: string) => {
    let event: ProviderEvent;
    try {
      event = JSON.parse(payload) as ProviderEvent;
    } catch (error) {
      log.debug("payloadBytes", payload.length);
      log.error(error, "failed to parse NOTIFY payload as JSON");
      return;
    }
    if (
      !event || typeof event !== "object" ||
      typeof (event as { kind?: unknown }).kind !== "string"
    ) {
      log.event("dropped NOTIFY payload with no recognizable event shape");
      return;
    }
    deps.bus.publishLocal(event);
  };

  const onListen = () => {
    log.event(`LISTEN ${PROVIDER_EVENTS_CHANNEL} subscribed`);
  };

  const subscription = await sql.listen(
    PROVIDER_EVENTS_CHANNEL,
    onNotify,
    onListen,
  );

  log.event("pgListener started");

  return async () => {
    log.event("stopping pgListener");
    try {
      await subscription.unlisten();
    } catch (error) {
      log.error(error, "unlisten failed");
    }
    try {
      await sql.end({ timeout: 5 });
    } catch (error) {
      log.error(error, "pgListener sql.end failed");
    }
    log.event("pgListener stopped");
  };
}
