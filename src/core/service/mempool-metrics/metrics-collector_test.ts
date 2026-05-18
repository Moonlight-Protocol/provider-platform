import "../../../../tests/ensure_test_env.ts";
import { assertEquals } from "@std/assert";
import { deriveActiveChannelContractIds } from "./metrics-collector.ts";
import {
  type CouncilMembership,
  CouncilMembershipStatus,
} from "@/persistence/drizzle/entity/council-membership.entity.ts";

function makeMembership(
  overrides: Partial<CouncilMembership> = {},
): CouncilMembership {
  const now = new Date();
  return {
    id: "m-1",
    ppPublicKey: "GPPXXX",
    councilUrl: "http://council.test",
    councilName: "Test Council",
    channelAuthId: "CAUTHXXX",
    councilPublicKey: "GCOUNCILXXX",
    status: CouncilMembershipStatus.ACTIVE,
    configJson: null,
    claimedJurisdictions: null,
    joinRequestId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  } as CouncilMembership;
}

const CHANNEL_A = "CALR67CX4BKF5HYAUK34DMHFEC4ZNJUIER64BDAB6HEC6TVY3DLJ4QVP";
const CHANNEL_B = "CBBB67CX4BKF5HYAUK34DMHFEC4ZNJUIER64BDAB6HEC6TVY3DLJ4QVP";

Deno.test("deriveActiveChannelContractIds — pulls channelContractId from configJson, NOT channelAuthId", () => {
  const m = makeMembership({
    channelAuthId: "CAUTH_NEVER_USE_THIS",
    configJson: JSON.stringify({
      channels: [{ channelContractId: CHANNEL_A, assetCode: "XLM" }],
    }),
  });
  assertEquals(deriveActiveChannelContractIds([m]), [CHANNEL_A]);
});

Deno.test("deriveActiveChannelContractIds — flattens channels across multiple memberships", () => {
  const m1 = makeMembership({
    id: "m-1",
    configJson: JSON.stringify({
      channels: [{ channelContractId: CHANNEL_A }],
    }),
  });
  const m2 = makeMembership({
    id: "m-2",
    configJson: JSON.stringify({
      channels: [{ channelContractId: CHANNEL_B }],
    }),
  });
  assertEquals(deriveActiveChannelContractIds([m1, m2]), [
    CHANNEL_A,
    CHANNEL_B,
  ]);
});

Deno.test("deriveActiveChannelContractIds — flattens multiple channels per membership", () => {
  const m = makeMembership({
    configJson: JSON.stringify({
      channels: [
        { channelContractId: CHANNEL_A },
        { channelContractId: CHANNEL_B },
      ],
    }),
  });
  assertEquals(deriveActiveChannelContractIds([m]), [CHANNEL_A, CHANNEL_B]);
});

Deno.test("deriveActiveChannelContractIds — skips non-ACTIVE memberships", () => {
  const pending = makeMembership({
    status: CouncilMembershipStatus.PENDING,
    configJson: JSON.stringify({
      channels: [{ channelContractId: CHANNEL_A }],
    }),
  });
  const rejected = makeMembership({
    id: "m-2",
    status: CouncilMembershipStatus.REJECTED,
    configJson: JSON.stringify({
      channels: [{ channelContractId: CHANNEL_B }],
    }),
  });
  assertEquals(deriveActiveChannelContractIds([pending, rejected]), []);
});

Deno.test("deriveActiveChannelContractIds — tolerates null configJson", () => {
  const m = makeMembership({ configJson: null });
  assertEquals(deriveActiveChannelContractIds([m]), []);
});

Deno.test("deriveActiveChannelContractIds — tolerates configJson with no channels key", () => {
  const m = makeMembership({
    configJson: JSON.stringify({ jurisdictions: [{ countryCode: "US" }] }),
  });
  assertEquals(deriveActiveChannelContractIds([m]), []);
});

Deno.test("deriveActiveChannelContractIds — tolerates malformed configJson without throwing", () => {
  const m = makeMembership({ configJson: "{not json" });
  assertEquals(deriveActiveChannelContractIds([m]), []);
});

Deno.test("deriveActiveChannelContractIds — drops channel entries missing channelContractId", () => {
  const m = makeMembership({
    configJson: JSON.stringify({
      channels: [{ assetCode: "XLM" }, { channelContractId: CHANNEL_A }],
    }),
  });
  assertEquals(deriveActiveChannelContractIds([m]), [CHANNEL_A]);
});
