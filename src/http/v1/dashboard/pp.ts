import { type Context, Status } from "@oak/oak";
import { Keypair } from "stellar-sdk";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PpRepository } from "@/persistence/drizzle/repository/pp.repository.ts";
import { CouncilMembershipRepository } from "@/persistence/drizzle/repository/council-membership.repository.ts";
import { encryptSk } from "@/core/crypto/encrypt-sk.ts";
import {
  addProviderAddress,
  removeProviderAddress,
} from "@/core/service/event-watcher/index.ts";
import { SERVICE_AUTH_SECRET } from "@/config/env.ts";
import type { Logger } from "@/utils/logger/index.ts";

const ppRepo = new PpRepository(drizzleClient);
const membershipRepo = new CouncilMembershipRepository(drizzleClient);

/**
 * POST /dashboard/pp/register
 */
export function handleRegisterPp(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("registerPp");

  return async (ctx) => {
    log.info("registerPp");
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

      const existing = await ppRepo.findByPublicKey(publicKey);
      if (existing) {
        if (
          existing.ownerPublicKey && existing.ownerPublicKey !== ownerPublicKey
        ) {
          ctx.response.status = Status.Forbidden;
          ctx.response.body = {
            message: "This provider belongs to another user",
          };
          return;
        }
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

      addProviderAddress(publicKey);

      log.debug("publicKey", publicKey);
      log.event("PP registered");

      ctx.response.status = Status.OK;
      ctx.response.body = {
        message: "Provider registered",
        data: { publicKey: pp.publicKey, isActive: pp.isActive },
      };
    } catch (error) {
      log.error(error, "failed to register PP");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to register provider" };
    }
  };
}

/**
 * GET /dashboard/pp/list
 */
export function handleListPps(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("listPps");

  return async (ctx) => {
    log.info("listPps");
    try {
      const ownerPublicKey = (ctx.state.session as { sub: string }).sub;
      const pps = await ppRepo.listByOwner(ownerPublicKey);

      const data = await Promise.all(pps.map(async (pp) => {
        const memberships = await membershipRepo.listAllForPp(pp.publicKey);

        const councilMemberships = memberships.map((membership) => {
          let claimedJurisdictions: string[] | null = null;
          if (membership.claimedJurisdictions) {
            try {
              claimedJurisdictions = JSON.parse(
                membership.claimedJurisdictions,
              );
            } catch {
              claimedJurisdictions = null;
            }
          }

          let councilJurisdictions: string[] | null = null;
          let channels: Array<{
            channelContractId: string;
            assetCode: string;
            assetContractId: string;
            label: string | null;
          }> = [];
          if (membership.configJson) {
            try {
              const cfg = JSON.parse(membership.configJson) as {
                jurisdictions?: Array<{ countryCode: string }>;
                channels?: Array<{
                  channelContractId: string;
                  assetCode: string;
                  assetContractId: string;
                  label: string | null;
                }>;
              };
              councilJurisdictions = (cfg.jurisdictions || []).map((j) =>
                j.countryCode
              );
              channels = cfg.channels || [];
            } catch {
              councilJurisdictions = null;
            }
          }

          return {
            councilUrl: membership.councilUrl,
            councilName: membership.councilName,
            status: membership.status,
            channelAuthId: membership.channelAuthId,
            claimedJurisdictions,
            councilJurisdictions,
            channels,
          };
        });

        return {
          publicKey: pp.publicKey,
          derivationIndex: pp.derivationIndex,
          label: pp.label,
          isActive: pp.isActive,
          createdAt: pp.createdAt.toISOString(),
          councilMemberships,
        };
      }));

      ctx.response.status = Status.OK;
      ctx.response.body = { message: "Providers listed", data };
    } catch (error) {
      log.error(error, "failed to list PPs");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to list providers" };
    }
  };
}

/**
 * DELETE /dashboard/pp/delete
 */
export function handleDeletePp(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("deletePp");

  return async (ctx) => {
    log.info("deletePp");
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
        ctx.response.body = {
          message: "This provider belongs to another user",
        };
        return;
      }

      removeProviderAddress(publicKey);

      const memberships = await membershipRepo.listAllForPp(publicKey);
      for (const m of memberships) {
        await membershipRepo.delete(m.id);
      }

      await ppRepo.hardDelete(pp.id);

      log.debug("publicKey", publicKey);
      log.event("PP deleted");

      ctx.response.status = Status.OK;
      ctx.response.body = { message: "Provider deleted" };
    } catch (error) {
      log.error(error, "failed to delete PP");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to delete provider" };
    }
  };
}
