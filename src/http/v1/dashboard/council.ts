import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilMembershipRepository } from "@/persistence/drizzle/repository/council-membership.repository.ts";
import { CouncilMembershipStatus } from "@/persistence/drizzle/entity/council-membership.entity.ts";
import { PpRepository } from "@/persistence/drizzle/repository/pp.repository.ts";
import { addCouncilWatcher, addProviderAddress } from "@/core/service/event-watcher/index.ts";
import { MODE } from "@/config/env.ts";
import { LOG } from "@/config/logger.ts";

/** Reject URLs targeting internal/private network addresses. Skipped in development mode. */
function isInternalUrl(url: URL): boolean {
  // Intentionally skip SSRF protection in dev mode so developers can target localhost services
  if (MODE === "development") return false;
  // Only allow http: and https: protocols
  if (url.protocol !== "http:" && url.protocol !== "https:") return true;

  const host = url.hostname.toLowerCase().replace(/\[|\]/g, "");

  // Reject hostnames without a dot (e.g. "localhost", single-label names)
  if (!host.includes(".")) return true;

  // Reject numeric-only hostnames (decimal/hex IP bypass attempts)
  if (/^\d+$/.test(host) || /^0x[\da-f]+$/i.test(host)) return true;

  // IPv6 checks
  if (host === "::1" || host.startsWith("::ffff:") || host.startsWith("fe80:")) return true;

  // Explicit localhost and zero address
  if (host === "0.0.0.0") return true;

  // Internal domain suffixes
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;

  // AWS metadata endpoint
  if (host === "169.254.169.254") return true;

  // Private IPv4 ranges
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;

  // IPv6-mapped IPv4 (e.g. ::ffff:127.0.0.1 in dotted form)
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/.test(host)) return true;

  return false;
}

const membershipRepo = new CouncilMembershipRepository(drizzleClient);
const ppRepo = new PpRepository(drizzleClient);

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

    if (isInternalUrl(parsed)) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "councilUrl must not target internal addresses" };
      return;
    }

    // Parse the URL to extract the base and optional council ID.
    // The council ID can be in the query string (?council=C...) or in a
    // hash fragment (#/join?council=C...) — the latter is the format used
    // by council-console join links. URL strips fragments, so we extract
    // it from the raw input first.
    let councilId = parsed.searchParams.get("council");
    if (!councilId) {
      const hashMatch = councilUrl.match(/[#?&]council=([A-Z0-9]+)/);
      if (hashMatch) councilId = hashMatch[1];
    }
    const baseUrl = `${parsed.origin}`;
    const councilQs = councilId ? `?councilId=${encodeURIComponent(councilId)}` : "";

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/api/v1/public/council${councilQs}`, {
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof DOMException && err.name === "AbortError") {
        ctx.response.status = Status.GatewayTimeout;
        ctx.response.body = { message: "Council request timed out" };
        return;
      }
      throw err;
    }
    clearTimeout(timeoutId);

    const contentLength = parseInt(res.headers.get("Content-Length") ?? "0", 10);
    if (contentLength > 1_048_576) {
      await res.body?.cancel();
      ctx.response.status = Status.BadGateway;
      ctx.response.body = { message: "Council response too large" };
      return;
    }

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
 * Requires ppPublicKey to identify which PP is joining.
 */
export const joinCouncilHandler = async (ctx: Context) => {
  try {
    const body = await ctx.request.body.json();
    const { councilUrl, councilId: bodyCouncilId, councilName, councilPublicKey, ppPublicKey, label, contactEmail, jurisdictions } = body;

    if (!councilUrl || typeof councilUrl !== "string") {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "councilUrl is required" };
      return;
    }

    if (!ppPublicKey || typeof ppPublicKey !== "string") {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "ppPublicKey is required" };
      return;
    }

    // SSRF protection
    try {
      const parsedUrl = new URL(councilUrl);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "councilUrl must be a valid HTTP(S) URL" };
        return;
      }
      if (isInternalUrl(parsedUrl)) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "councilUrl must not target internal addresses" };
        return;
      }
    } catch {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "councilUrl must be a valid URL" };
      return;
    }

    // Verify PP is registered and owned by this user
    const ownerPublicKey = (ctx.state.session as { sub: string }).sub;
    const pp = await ppRepo.findByPublicKeyAndOwner(ppPublicKey, ownerPublicKey);
    if (!pp) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "PP not registered. Register it first." };
      return;
    }

    const baseUrl = councilUrl.replace(/\/+$/, "");

    // Check if this PP already has a membership for this council
    const existing = await membershipRepo.findByCouncilUrlAndPp(baseUrl, ppPublicKey);
    if (existing) {
      ctx.response.status = Status.Conflict;
      ctx.response.body = {
        message: `This PP is already ${existing.status.toLowerCase()} for this council`,
        data: { status: existing.status },
      };
      return;
    }

    if (!bodyCouncilId || typeof bodyCouncilId !== "string") {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "councilId is required" };
      return;
    }
    const councilId = bodyCouncilId;

    // The client must provide a pre-signed join request envelope
    const { signedEnvelope } = body;
    if (!signedEnvelope || !signedEnvelope.payload || !signedEnvelope.signature || !signedEnvelope.publicKey) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "signedEnvelope is required (payload, signature, publicKey, timestamp)" };
      return;
    }

    // Verify the envelope's publicKey matches the claimed ppPublicKey
    if (signedEnvelope.publicKey !== ppPublicKey) {
      LOG.warn("Join request publicKey mismatch", {
        envelopePublicKey: signedEnvelope.publicKey,
        ppPublicKey,
      });
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "signedEnvelope publicKey does not match ppPublicKey" };
      return;
    }

    // Relay the pre-signed envelope to the council-platform
    const joinController = new AbortController();
    const joinTimeoutId = setTimeout(() => joinController.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/api/v1/public/provider/join-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signedEnvelope),
        signal: joinController.signal,
      });
    } catch (err) {
      clearTimeout(joinTimeoutId);
      if (err instanceof DOMException && err.name === "AbortError") {
        ctx.response.status = Status.GatewayTimeout;
        ctx.response.body = { message: "Council join request timed out" };
        return;
      }
      throw err;
    }
    clearTimeout(joinTimeoutId);

    if (res.status === 409) {
      ctx.response.status = Status.Conflict;
      ctx.response.body = { message: "A pending request already exists for this provider" };
      return;
    }

    if (!res.ok) {
      await res.body?.cancel();
      ctx.response.status = Status.BadGateway;
      ctx.response.body = { message: "Council rejected the request" };
      return;
    }

    const { data: responseData } = await res.json();

    // Create membership record scoped to this PP
    await membershipRepo.create({
      id: crypto.randomUUID(),
      councilUrl: baseUrl,
      councilName: councilName ?? null,
      councilPublicKey: councilPublicKey ?? "",
      channelAuthId: councilId,
      status: CouncilMembershipStatus.PENDING,
      joinRequestId: responseData?.id ?? null,
      ppPublicKey,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Start watching this council's Channel Auth contract for provider_added/removed events
    addCouncilWatcher(councilId);
    addProviderAddress(ppPublicKey);

    LOG.info("Join request submitted to council", {
      councilUrl: baseUrl,
      ppPublicKey,
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
 * Returns council membership for a specific PP.
 * Query: ?ppPublicKey=G...
 */
export const getMembershipHandler = async (ctx: Context) => {
  try {
    const ppPublicKey = ctx.request.url.searchParams.get("ppPublicKey");

    if (!ppPublicKey) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "ppPublicKey query parameter is required" };
      return;
    }

    // Verify PP ownership
    const ownerPublicKey = (ctx.state.session as { sub: string }).sub;
    const pp = await ppRepo.findByPublicKeyAndOwner(ppPublicKey, ownerPublicKey);
    if (!pp) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Provider not found" };
      return;
    }

    const membership = await membershipRepo.getCurrentForPp(ppPublicKey);

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
        config: membership.configJson ? (() => { try { return JSON.parse(membership.configJson); } catch { return null; } })() : null,
        joinRequestId: membership.joinRequestId,
        ppPublicKey: membership.ppPublicKey,
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

/**
 * POST /dashboard/council/membership
 * Syncs a PP's membership status by querying the council's public endpoint.
 * Updates the local DB if the status has changed.
 * Body: { ppPublicKey: string }
 */
export const syncMembershipHandler = async (ctx: Context) => {
  try {
    const body = await ctx.request.body.json();
    const { ppPublicKey } = body;

    if (!ppPublicKey || typeof ppPublicKey !== "string") {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "ppPublicKey is required" };
      return;
    }

    // Verify PP ownership
    const ownerPublicKey = (ctx.state.session as { sub: string }).sub;
    const pp = await ppRepo.findByPublicKeyAndOwner(ppPublicKey, ownerPublicKey);
    if (!pp) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Provider not found" };
      return;
    }

    const membership = await membershipRepo.getCurrentForPp(ppPublicKey);
    if (!membership) {
      ctx.response.status = Status.OK;
      ctx.response.body = { message: "No membership", data: { status: null } };
      return;
    }

    // Query the council's public membership-status endpoint
    const { councilUrl, channelAuthId } = membership;
    let remoteStatus: number | null = null;
    let remoteBody: { status?: string } | null = null;
    try {
      const res = await fetch(
        `${councilUrl}/api/v1/public/provider/membership-status?councilId=${encodeURIComponent(channelAuthId)}&publicKey=${encodeURIComponent(ppPublicKey)}`,
      );
      remoteStatus = res.status;
      try {
        remoteBody = await res.json();
      } catch { /* body may not be JSON */ }
    } catch (err) {
      LOG.warn("Failed to query council membership status", {
        councilUrl, channelAuthId, ppPublicKey,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (remoteStatus === 200 && membership.status !== CouncilMembershipStatus.ACTIVE) {
      // Fetch config from council
      let configJson: string | null = membership.configJson;
      let councilName = membership.councilName;
      try {
        const configRes = await fetch(
          `${councilUrl}/api/v1/public/council?councilId=${encodeURIComponent(channelAuthId)}`,
        );
        if (configRes.ok) {
          const { data } = await configRes.json();
          configJson = JSON.stringify(data);
          councilName = data.council?.name ?? councilName;
        }
      } catch { /* best effort */ }

      await membershipRepo.update(membership.id, {
        status: CouncilMembershipStatus.ACTIVE,
        configJson,
        councilName,
      });
      LOG.info("Membership synced to ACTIVE", { ppPublicKey, channelAuthId });

      ctx.response.status = Status.OK;
      ctx.response.body = { message: "Membership synced", data: { status: "ACTIVE" } };
      return;
    }

    // Council returns 404 + body { status: "NOT_FOUND" } for both rejected
    // and never-existed providers — by design, to prevent enumeration of
    // rejected pubkeys via the public endpoint. We can still distinguish:
    // if our LOCAL state is PENDING then we know we did submit a join request
    // (joinRequestId is set) and the council acknowledged it. If the council
    // now says we don't exist, the only consistent interpretation is that
    // the request was rejected. Inferring REJECTED from absence + local
    // PENDING is sound and doesn't require any new endpoints on the council.
    if (remoteStatus === 404 && membership.status === CouncilMembershipStatus.PENDING) {
      await membershipRepo.update(membership.id, {
        status: CouncilMembershipStatus.REJECTED,
      });
      LOG.info("Membership synced to REJECTED", { ppPublicKey, channelAuthId });

      ctx.response.status = Status.OK;
      ctx.response.body = { message: "Membership synced", data: { status: "REJECTED" } };
      return;
    }

    ctx.response.status = Status.OK;
    ctx.response.body = { message: "Membership unchanged", data: { status: membership.status } };
  } catch (error) {
    LOG.error("Failed to sync membership", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to sync membership" };
  }
};
