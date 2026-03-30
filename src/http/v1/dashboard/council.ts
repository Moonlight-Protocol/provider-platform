import { type Context, Status } from "@oak/oak";
import { Keypair } from "stellar-sdk";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilMembershipRepository } from "@/persistence/drizzle/repository/council-membership.repository.ts";
import { CouncilMembershipStatus } from "@/persistence/drizzle/entity/council-membership.entity.ts";
import { signPayload } from "@/core/crypto/signed-payload.ts";
import { PROVIDER_SK, PORT } from "@/config/env.ts";
import { LOG } from "@/config/logger.ts";

const membershipRepo = new CouncilMembershipRepository(drizzleClient);
const providerKeypair = Keypair.fromSecret(PROVIDER_SK);

/**
 * POST /dashboard/council/discover
 * Fetches council info from the council-platform's public API.
 */
export const discoverCouncilHandler = async (ctx: Context) => {
  try {
    const body = await ctx.request.body.json();
    const { councilUrl } = body;

    if (!councilUrl || typeof councilUrl !== "string") {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "councilUrl is required" };
      return;
    }

    // Validate URL format — must be HTTP(S)
    let parsed: URL;
    try {
      parsed = new URL(councilUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("bad protocol");
      }
    } catch {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "councilUrl must be a valid HTTP(S) URL" };
      return;
    }
    const councilId = parsed.searchParams.get("council");
    const baseUrl = `${parsed.origin}`;
    const res = await fetch(`${baseUrl}/api/v1/public/council`);

    if (!res.ok) {
      ctx.response.status = Status.BadGateway;
      ctx.response.body = { message: `Failed to reach council: HTTP ${res.status}` };
      return;
    }

    const { data } = await res.json();

    if (!data?.council) {
      ctx.response.status = Status.BadGateway;
      ctx.response.body = { message: "Council not found at this URL" };
      return;
    }

    // If a specific council ID was in the URL, verify it matches
    if (councilId && data.council.channelAuthId !== councilId) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Council ID in URL does not match the council at this endpoint" };
      return;
    }

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Council discovered",
      data: {
        councilUrl: baseUrl,
        council: data.council,
        jurisdictions: data.jurisdictions,
        channels: data.channels,
        providers: data.providers,
      },
    };
  } catch (error) {
    LOG.error("Council discovery failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to discover council" };
  }
};

/**
 * POST /dashboard/council/join
 * Submits a signed join request to the council-platform.
 */
export const joinCouncilHandler = async (ctx: Context) => {
  try {
    const body = await ctx.request.body.json();
    const { councilUrl, label, contactEmail, jurisdictions } = body;

    if (!councilUrl || typeof councilUrl !== "string") {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "councilUrl is required" };
      return;
    }

    // Check if already joined or pending
    const existing = await membershipRepo.findByCouncilUrl(councilUrl.replace(/\/+$/, ""));
    if (existing) {
      ctx.response.status = Status.Conflict;
      ctx.response.body = {
        message: `Already ${existing.status.toLowerCase()} for this council`,
        data: { status: existing.status },
      };
      return;
    }

    const baseUrl = councilUrl.replace(/\/+$/, "");

    // Build the callback endpoint for config push
    const rawProto = ctx.request.headers.get("x-forwarded-proto") || ctx.request.url.protocol.replace(":", "");
    const requestProto = rawProto === "https" ? "https" : "http";
    const requestHost = ctx.request.url.hostname;
    const callbackEndpoint = `${requestProto}://${requestHost}:${PORT}`;

    // Build and sign the join request payload
    const joinPayload = {
      publicKey: providerKeypair.publicKey(),
      label: label?.trim() ?? null,
      contactEmail: contactEmail?.trim() ?? null,
      jurisdictions: jurisdictions ?? null,
      callbackEndpoint,
    };

    const signed = await signPayload(joinPayload, PROVIDER_SK);

    // Submit to council-platform
    const res = await fetch(`${baseUrl}/api/v1/public/provider/join-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signed),
    });

    if (res.status === 409) {
      ctx.response.status = Status.Conflict;
      ctx.response.body = { message: "A pending request already exists for this provider" };
      return;
    }

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      ctx.response.status = Status.BadGateway;
      ctx.response.body = { message: errBody.message || `Council rejected request: HTTP ${res.status}` };
      return;
    }

    const { data: responseData } = await res.json();

    // Fetch council info for storage
    const councilRes = await fetch(`${baseUrl}/api/v1/public/council`);
    const councilData = councilRes.ok ? (await councilRes.json()).data : null;

    // Create membership record
    await membershipRepo.create({
      id: crypto.randomUUID(),
      councilUrl: baseUrl,
      councilName: councilData?.council?.name ?? null,
      councilPublicKey: councilData?.council?.councilPublicKey ?? "",
      channelAuthId: councilData?.council?.channelAuthId ?? "",
      status: CouncilMembershipStatus.PENDING,
      joinRequestId: responseData?.id ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    LOG.info("Join request submitted to council", {
      councilUrl: baseUrl,
      joinRequestId: responseData?.id,
    });

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Join request submitted",
      data: {
        joinRequestId: responseData?.id,
        status: "PENDING",
      },
    };
  } catch (error) {
    LOG.error("Failed to join council", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to submit join request" };
  }
};

/**
 * GET /dashboard/council/membership
 * Returns the current council membership status and config.
 */
export const getMembershipHandler = async (ctx: Context) => {
  try {
    const membership = await membershipRepo.getCurrent();

    if (!membership) {
      ctx.response.status = Status.OK;
      ctx.response.body = {
        message: "No council membership",
        data: null,
      };
      return;
    }

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Council membership",
      data: {
        id: membership.id,
        councilUrl: membership.councilUrl,
        councilName: membership.councilName,
        councilPublicKey: membership.councilPublicKey,
        channelAuthId: membership.channelAuthId,
        status: membership.status,
        config: membership.configJson ? JSON.parse(membership.configJson) : null,
        joinRequestId: membership.joinRequestId,
        createdAt: membership.createdAt.toISOString(),
      },
    };
  } catch (error) {
    LOG.error("Failed to get membership", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to retrieve membership" };
  }
};
