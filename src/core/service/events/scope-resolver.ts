import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import {
  councilMembership,
  CouncilMembershipStatus,
} from "@/persistence/drizzle/entity/council-membership.entity.ts";
import { paymentProvider } from "@/persistence/drizzle/entity/pp.entity.ts";
import type { EventScope } from "@/core/service/events/event.types.ts";

export type ScopeResolverDeps = {
  db: typeof drizzleClient;
};

const defaultDeps: ScopeResolverDeps = { db: drizzleClient };

/**
 * Returns the EventScope rows for every PP on this instance that is ACTIVE on
 * the given channel. Each emission site iterates the returned list and emits
 * one event per scope so single-PP-bound WebSocket subscribers see only their
 * own events.
 */
export async function resolveScopesForChannel(
  channelContractId: string,
  deps: ScopeResolverDeps = defaultDeps,
): Promise<EventScope[]> {
  const rows = await deps.db
    .select({
      ppPublicKey: paymentProvider.publicKey,
      ppLabel: paymentProvider.label,
    })
    .from(paymentProvider)
    .innerJoin(
      councilMembership,
      eq(councilMembership.ppPublicKey, paymentProvider.publicKey),
    )
    .where(
      and(
        eq(councilMembership.status, CouncilMembershipStatus.ACTIVE),
        isNull(councilMembership.deletedAt),
        sql`${councilMembership.configJson}::jsonb -> 'channels' @> ${
          JSON.stringify([{ channelContractId }])
        }::jsonb`,
      ),
    );
  return rows.map((row) => ({
    ppPublicKey: row.ppPublicKey,
    ppLabel: row.ppLabel,
  }));
}

/**
 * Returns the EventScope for a PP identified by publicKey, or null if not
 * present on this instance. Used for channel.provider_* events where the
 * event-watcher already tells us which PP changed.
 */
export async function resolveScopeForPp(
  ppPublicKey: string,
  deps: ScopeResolverDeps = defaultDeps,
): Promise<EventScope | null> {
  const [row] = await deps.db
    .select({
      ppPublicKey: paymentProvider.publicKey,
      ppLabel: paymentProvider.label,
    })
    .from(paymentProvider)
    .where(eq(paymentProvider.publicKey, ppPublicKey))
    .limit(1);
  if (!row) return null;
  return { ppPublicKey: row.ppPublicKey, ppLabel: row.ppLabel };
}
