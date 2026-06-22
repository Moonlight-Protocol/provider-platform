import type { Server } from "stellar-sdk/rpc";
import { Address, type Contract, scValToNative, type xdr } from "stellar-sdk";
import { withSpan } from "@/core/tracing.ts";
import type {
  ChannelAuthEvent,
  ChannelAuthEventType,
} from "./event-watcher.types.ts";
import type { Logger } from "@/utils/logger/index.ts";

const KNOWN_TOPICS: Record<string, ChannelAuthEventType> = {
  contract_initialized: "contract_initialized",
  provider_added: "provider_added",
  provider_removed: "provider_removed",
  channel_state_changed: "channel_state_changed",
};

// Stellar RPC getEvents filter limits: up to 5 contractIds per filter and up to
// 5 filters per call (≈25 contracts/call). Watching more councils than that
// fans out into multiple sequential getEvents calls.
const MAX_CONTRACT_IDS_PER_FILTER = 5;
const MAX_FILTERS_PER_CALL = 5;
const MAX_CONTRACT_IDS_PER_CALL = MAX_CONTRACT_IDS_PER_FILTER *
  MAX_FILTERS_PER_CALL;

/** Split a list into fixed-size chunks (last chunk may be shorter). */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Build the batched getEvents calls for a set of contract IDs, respecting the
 * 5-contractIds-per-filter / 5-filters-per-call RPC limits. Each returned entry
 * is the `filters` array for one getEvents call.
 */
function buildEventFilterBatches(
  contractIds: string[],
): { type: "contract"; contractIds: string[] }[][] {
  const filters = chunk(contractIds, MAX_CONTRACT_IDS_PER_FILTER).map((
    ids,
  ) => ({
    type: "contract" as const,
    contractIds: ids,
  }));
  return chunk(filters, MAX_FILTERS_PER_CALL);
}

/**
 * Normalize the `contractId` of a raw RPC event to its string form. The SDK
 * surfaces it as a `Contract` instance; test mocks supply the string directly.
 */
function rawEventContractId(
  contractId: Contract | string | undefined,
): string | undefined {
  if (contractId == null) return undefined;
  return typeof contractId === "string" ? contractId : contractId.contractId();
}

/**
 * Decodes an xdr.ScVal representing an Address into a string.
 */
function decodeAddress(val: xdr.ScVal): string {
  return Address.fromScVal(val).toString();
}

/**
 * Parses the topic symbol from an ScVal.
 * The first topic in a contractevent is a Symbol with the event name.
 */
function decodeTopicSymbol(val: xdr.ScVal): string | null {
  if (val.switch().name === "scvSymbol") {
    return val.sym().toString();
  }
  return null;
}

/**
 * Parse a single raw RPC event into a ChannelAuthEvent, or null if it is not a
 * known/well-formed Channel Auth event. The event's source contract is taken
 * from the raw event itself (`contractId`) so a single multi-contract poll can
 * be routed back to the right council.
 */
function parseRawEvent(
  rawEvent: {
    topic?: xdr.ScVal[];
    value: xdr.ScVal;
    ledger: number;
    contractId?: Contract | string;
  },
  log: Logger,
): ChannelAuthEvent | null {
  const topics = rawEvent.topic;
  if (!topics || topics.length < 2) return null;

  const topicSymbol = decodeTopicSymbol(topics[0]);
  if (!topicSymbol || !(topicSymbol in KNOWN_TOPICS)) return null;

  const contractId = rawEventContractId(rawEvent.contractId);
  if (!contractId) {
    log.debug("topicSymbol", topicSymbol);
    log.event("skipping event with no source contract id");
    return null;
  }

  const eventType = KNOWN_TOPICS[topicSymbol];

  // ChannelStateChanged carries two address topics (channel, asset) and a
  // boolean data value (enabled). `address` mirrors the channel so the
  // shared {type, address, ledger} handler shape still applies.
  if (eventType === "channel_state_changed") {
    if (topics.length < 3) return null;
    const channel = decodeAddress(topics[1]);
    const asset = decodeAddress(topics[2]);
    const enabled = Boolean(scValToNative(rawEvent.value));
    return {
      type: eventType,
      address: channel,
      channel,
      asset,
      enabled,
      ledger: rawEvent.ledger,
      contractId,
    };
  }

  return {
    type: eventType,
    address: decodeAddress(topics[1]),
    ledger: rawEvent.ledger,
    contractId,
  };
}

/**
 * Fetches Channel Auth contract events from the Stellar RPC server starting from
 * a given ledger, for every contract in `contractIds` in one logical poll. The
 * contract IDs are batched into the RPC filter (5 per filter, 5 filters per
 * call); more contracts than fit in one call fan out into sequential calls.
 *
 * Each parsed event carries the contract it was emitted by, so the caller can
 * dispatch it to the correct council without one watcher per contract.
 *
 * @param rpcServer - Stellar RPC server instance
 * @param contractIds - Channel Auth contract IDs to filter events for
 * @param startLedger - Ledger to start fetching events from
 * @returns Parsed channel auth events (ordered by ledger) and the latest ledger
 *   it is safe to advance the cursor past
 */
export function fetchChannelAuthEvents(
  rpcServer: Server,
  contractIds: string[],
  startLedger: number,
  deps: { log: Logger },
): Promise<{ events: ChannelAuthEvent[]; latestLedger: number }> {
  return withSpan(
    "EventWatcher.fetchChannelAuthEvents",
    async (span) => {
      const log = deps.log.scope("fetchChannelAuthEvents");
      log.info("fetchChannelAuthEvents");
      log.debug("contractCount", contractIds.length);
      log.debug("startLedger", startLedger);

      // Nothing to watch yet (no active memberships): never call getEvents with
      // empty filters — that would match every contract on the network. Hold the
      // cursor where it is so it advances once contracts are added.
      if (contractIds.length === 0) {
        log.event("no contracts to watch; skipping poll");
        return { events: [], latestLedger: startLedger - 1 };
      }

      const callBatches = buildEventFilterBatches(contractIds);
      if (contractIds.length > MAX_CONTRACT_IDS_PER_CALL) {
        log.debug("contractCount", contractIds.length);
        log.debug("callCount", callBatches.length);
        log.event(
          "watching more contracts than fit one getEvents call; batching",
        );
      }

      span.addEvent("fetching_events", {
        "contract.count": contractIds.length,
        "call.count": callBatches.length,
        "start.ledger": startLedger,
      });
      log.event("fetching contract events from RPC");

      const parsed: ChannelAuthEvent[] = [];
      // Advance only as far as the least-advanced call reports, so a later call
      // that happens to see a higher latest ledger can never skip events an
      // earlier call has not covered yet.
      let latestLedger = Infinity;

      for (const filters of callBatches) {
        const response = await rpcServer.getEvents({ startLedger, filters });
        latestLedger = Math.min(latestLedger, response.latestLedger);
        for (const rawEvent of response.events) {
          const event = parseRawEvent(rawEvent, log);
          if (event) parsed.push(event);
        }
      }

      // Restore chronological order across batches (within a single call the RPC
      // already returns events in ledger order).
      parsed.sort((a, b) => a.ledger - b.ledger);

      span.addEvent("events_fetched", {
        "events.count": parsed.length,
        "latest.ledger": latestLedger,
      });
      log.debug("eventCount", parsed.length);
      log.debug("latestLedger", latestLedger);
      log.event("events parsed");

      return { events: parsed, latestLedger };
    },
  );
}
