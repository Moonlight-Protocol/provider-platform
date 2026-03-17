import type { Server } from "stellar-sdk/rpc";
import { xdr, Address } from "stellar-sdk";
import { withSpan } from "@/core/tracing.ts";
import type {
  ChannelAuthEvent,
  ChannelAuthEventType,
} from "./event-watcher.types.ts";

const KNOWN_TOPICS: Record<string, ChannelAuthEventType> = {
  contract_initialized: "contract_initialized",
  provider_added: "provider_added",
  provider_removed: "provider_removed",
};

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
 * Fetches Channel Auth contract events from the Stellar RPC server
 * starting from a given ledger.
 *
 * @param rpcServer - Stellar RPC server instance
 * @param contractId - Channel Auth contract ID to filter events for
 * @param startLedger - Ledger to start fetching events from
 * @returns Parsed channel auth events and the latest ledger seen
 */
export async function fetchChannelAuthEvents(
  rpcServer: Server,
  contractId: string,
  startLedger: number,
): Promise<{ events: ChannelAuthEvent[]; latestLedger: number }> {
  return withSpan(
    "EventWatcher.fetchChannelAuthEvents",
    async (span) => {
      span.addEvent("fetching_events", {
        "contract.id": contractId,
        "start.ledger": startLedger,
      });

      const response = await rpcServer.getEvents({
        startLedger,
        filters: [
          {
            type: "contract",
            contractIds: [contractId],
          },
        ],
      });

      const latestLedger = response.latestLedger;
      const parsed: ChannelAuthEvent[] = [];

      for (const rawEvent of response.events) {
        const topics = rawEvent.topic;
        if (!topics || topics.length < 2) continue;

        const topicSymbol = decodeTopicSymbol(topics[0]);
        if (!topicSymbol || !(topicSymbol in KNOWN_TOPICS)) continue;

        const eventType = KNOWN_TOPICS[topicSymbol];
        const address = decodeAddress(topics[1]);

        parsed.push({
          type: eventType,
          address,
          ledger: rawEvent.ledger,
          contractId,
        });
      }

      span.addEvent("events_fetched", {
        "events.count": parsed.length,
        "latest.ledger": latestLedger,
      });

      return { events: parsed, latestLedger };
    },
  );
}
