import { assertEquals } from "@std/assert";
import { newNoop } from "@/utils/logger/index.ts";
import {
  handleCouncilRemovalNotice,
  type MembershipStatus,
  type RemovalNoticeDeps,
} from "./handle-removal.ts";
import {
  type CouncilMembership,
  CouncilMembershipStatus,
} from "@/persistence/drizzle/entity/council-membership.entity.ts";

const CHANNEL_AUTH = "CCHANNELAUTH";
const PP_PK = "GPP";
const COUNCIL_URL = "https://council.example.com";

function membership(over: Partial<CouncilMembership>): CouncilMembership {
  return {
    id: "m-1",
    councilUrl: COUNCIL_URL,
    councilName: "Council",
    councilPublicKey: "GCOUNCIL",
    channelAuthId: CHANNEL_AUTH,
    status: CouncilMembershipStatus.ACTIVE,
    configJson: null,
    claimedJurisdictions: null,
    joinRequestId: null,
    ppPublicKey: PP_PK,
    ...over,
  } as CouncilMembership;
}

function deps(
  current: CouncilMembership | undefined,
  councilSays: MembershipStatus,
) {
  const updates: Array<{ id: string; status: CouncilMembershipStatus }> = [];
  const d: RemovalNoticeDeps = {
    ppRepo: { listAll: () => Promise.resolve([{ publicKey: PP_PK }]) },
    membershipRepo: {
      getCurrentForPp: (_pk: string) => Promise.resolve(current),
      update: (id: string, fields: { status: CouncilMembershipStatus }) => {
        updates.push({ id, status: fields.status });
        return Promise.resolve(undefined);
      },
    },
    log: newNoop(),
    fetchStatus: (_url, _cid, _pk) => Promise.resolve(councilSays),
  };
  return { d, updates };
}

Deno.test("council confirms NOT_FOUND → active membership demoted to REJECTED", async () => {
  const { d, updates } = deps(membership({}), "NOT_FOUND");
  const res = await handleCouncilRemovalNotice(CHANNEL_AUTH, d);
  assertEquals(res.deactivated, [PP_PK]);
  assertEquals(updates, [{
    id: "m-1",
    status: CouncilMembershipStatus.REJECTED,
  }]);
});

Deno.test("council still reports ACTIVE → forged/stale notice is ignored", async () => {
  const { d, updates } = deps(membership({}), "ACTIVE");
  const res = await handleCouncilRemovalNotice(CHANNEL_AUTH, d);
  assertEquals(res.deactivated, []);
  assertEquals(updates, []);
});

Deno.test("council unreachable (UNKNOWN) → membership left untouched", async () => {
  const { d, updates } = deps(membership({}), "UNKNOWN");
  const res = await handleCouncilRemovalNotice(CHANNEL_AUTH, d);
  assertEquals(res.deactivated, []);
  assertEquals(updates, []);
});

Deno.test("notice for a different council → skipped", async () => {
  const { d, updates } = deps(
    membership({ channelAuthId: "COTHER" }),
    "NOT_FOUND",
  );
  const res = await handleCouncilRemovalNotice(CHANNEL_AUTH, d);
  assertEquals(res.deactivated, []);
  assertEquals(updates, []);
});

Deno.test("membership not currently ACTIVE → skipped (idempotent)", async () => {
  const { d, updates } = deps(
    membership({ status: CouncilMembershipStatus.REJECTED }),
    "NOT_FOUND",
  );
  const res = await handleCouncilRemovalNotice(CHANNEL_AUTH, d);
  assertEquals(res.deactivated, []);
  assertEquals(updates, []);
});
