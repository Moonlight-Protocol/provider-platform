import { type Context, Status } from "@oak/oak";
import { Keypair } from "stellar-sdk";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PpRepository } from "@/persistence/drizzle/repository/pp.repository.ts";
import { CouncilMembershipRepository } from "@/persistence/drizzle/repository/council-membership.repository.ts";
import { encryptSk, decryptSk } from "@/core/crypto/encrypt-sk.ts";
import { addProviderAddress, removeProviderAddress } from "@/core/service/event-watcher/index.ts";
import { SERVICE_AUTH_SECRET } from "@/config/env.ts";
import { LOG } from "@/config/logger.ts";

const ppRepo = new PpRepository(drizzleClient);
const membershipRepo = new CouncilMembershipRepository(drizzleClient);

/**
 * POST /dashboard/pp/register
 * Registers a new PP. Encrypts the secret key and stores it.
 * Adds the provider address to the event watcher.
 */
export const registerPpHandler = async (ctx: Context) => {
  try {
    const body = await ctx.request.body.json();
    const { secretKey, derivationIndex, label } = body;

    if (!secretKey || typeof secretKey !== "string") {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "secretKey is required" };
      return;
    }

    let publicKey: string;
    try {
      publicKey = Keypair.fromSecret(secretKey).publicKey();
    } catch {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Invalid Stellar secret key" };
      return;
    }

    const ownerPublicKey = (ctx.state.session as { sub: string }).sub;

    // Check if already registered
    const existing = await ppRepo.findByPublicKey(publicKey);
    if (existing) {
      if (existing.ownerPublicKey && existing.ownerPublicKey !== ownerPublicKey) {
        ctx.response.status = Status.Forbidden;
        ctx.response.body = { message: "This provider belongs to another user" };
        return;
      }
      // Re-activate if it was deactivated
      if (!existing.isActive) {
        await ppRepo.activate(existing.id);
        addProviderAddress(publicKey);
      }
      ctx.response.status = Status.OK;
      ctx.response.body = {
        message: "Provider already registered",
        data: { publicKey, isActive: true },
      };
      return;
    }

    const encrypted = await encryptSk(secretKey, SERVICE_AUTH_SECRET);

    const pp = await ppRepo.create({
      id: crypto.randomUUID(),
      publicKey,
      encryptedSk: encrypted,
      derivationIndex,
      ownerPublicKey,
      isActive: true,
      label: label?.trim() ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Register with event watcher
    addProviderAddress(publicKey);

    LOG.info("PP registered", { publicKey });

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Provider registered",
      data: { publicKey: pp.publicKey, isActive: pp.isActive },
    };
  } catch (error) {
    LOG.error("Failed to register PP", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to register provider" };
  }
};


/**
 * GET /dashboard/pp/list
 * Lists PPs owned by the authenticated user, with council membership status.
 */
export const listPpsHandler = async (ctx: Context) => {
  try {
    const ownerPublicKey = (ctx.state.session as { sub: string }).sub;
    const pps = await ppRepo.listByOwner(ownerPublicKey);

    const data = await Promise.all(pps.map(async (pp) => {
      const membership = await membershipRepo.getCurrentForPp(pp.publicKey);
      return {
        publicKey: pp.publicKey,
        derivationIndex: pp.derivationIndex,
        label: pp.label,
        isActive: pp.isActive,
        createdAt: pp.createdAt.toISOString(),
        councilMembership: membership ? {
          councilUrl: membership.councilUrl,
          councilName: membership.councilName,
          status: membership.status,
          channelAuthId: membership.channelAuthId,
        } : null,
      };
    }));

    ctx.response.status = Status.OK;
    ctx.response.body = { message: "Providers listed", data };
  } catch (error) {
    LOG.error("Failed to list PPs", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to list providers" };
  }
};

/**
 * DELETE /dashboard/pp/delete
 * Hard-deletes a PP and its council memberships. Owner must match.
 */
export const deletePpHandler = async (ctx: Context) => {
  try {
    const body = await ctx.request.body.json();
    const { publicKey } = body;

    if (!publicKey || typeof publicKey !== "string") {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "publicKey is required" };
      return;
    }

    const ownerPublicKey = (ctx.state.session as { sub: string }).sub;

    const pp = await ppRepo.findByPublicKey(publicKey);
    if (!pp) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Provider not found" };
      return;
    }

    if (pp.ownerPublicKey !== ownerPublicKey) {
      ctx.response.status = Status.Forbidden;
      ctx.response.body = { message: "This provider belongs to another user" };
      return;
    }

    removeProviderAddress(publicKey);
    await ppRepo.hardDelete(pp.id);

    LOG.info("PP deleted", { publicKey });

    ctx.response.status = Status.OK;
    ctx.response.body = { message: "Provider deleted" };
  } catch (error) {
    LOG.error("Failed to delete PP", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to delete provider" };
  }
};
