import { assertEquals } from "@std/assert";
import { newNoop } from "@/utils/logger/index.ts";
import {
  convergeMembershipStatusesOnBoot,
  type MembershipConvergeDeps,
  type MembershipStatus,
} from "./membership-convergence.ts";

const PP_PK = "GPP";
const CHANNEL_AUTH = "CCHANNELAUTH";
const COUNCIL_URL = "https://council.example.com";

function deps(
  membership: { channelAuthId: string; councilUrl: string } | undefined,
  councilSays: MembershipStatus,
) {
  const deactivated: Array<{ pk: string; channelAuthId: string }> = [];
  const d: MembershipConvergeDeps = {
    listPps: () => Promise.resolve([{ publicKey: PP_PK }]),
    getActiveMembership: (_pk: string) => Promise.resolve(membership),
    fetchStatus: (_url, _cid, _pk) => Promise.resolve(councilSays),
    deactivate: (pk: string, channelAuthId: string) => {
      deactivated.push({ pk, channelAuthId });
      return Promise.resolve();
    },
    log: newNoop(),
  };
  return { d, deactivated };
}

const active = { channelAuthId: CHANNEL_AUTH, councilUrl: COUNCIL_URL };

Deno.test("boot converge: council reports NOT_FOUND → membership deactivated", async () => {
  const { d, deactivated } = deps(active, "NOT_FOUND");
  const res = await convergeMembershipStatusesOnBoot(d);
  assertEquals(res.demoted, [PP_PK]);
  assertEquals(deactivated, [{ pk: PP_PK, channelAuthId: CHANNEL_AUTH }]);
});

Deno.test("boot converge: council still ACTIVE → left untouched", async () => {
  const { d, deactivated } = deps(active, "ACTIVE");
  const res = await convergeMembershipStatusesOnBoot(d);
  assertEquals(res.demoted, []);
  assertEquals(deactivated, []);
});

Deno.test("boot converge: council unreachable (UNKNOWN) → left untouched", async () => {
  const { d, deactivated } = deps(active, "UNKNOWN");
  const res = await convergeMembershipStatusesOnBoot(d);
  assertEquals(res.demoted, []);
  assertEquals(deactivated, []);
});

Deno.test("boot converge: no active membership → skipped", async () => {
  const { d, deactivated } = deps(undefined, "NOT_FOUND");
  const res = await convergeMembershipStatusesOnBoot(d);
  assertEquals(res.demoted, []);
  assertEquals(deactivated, []);
});
