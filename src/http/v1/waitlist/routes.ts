import { Router, Status } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { WaitlistRequestRepository } from "@/persistence/drizzle/repository/waitlist-request.repository.ts";
import { notifyDiscord } from "@/http/v1/waitlist/discord-notify.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SOURCE = "provider-console";

const waitlistRepo = new WaitlistRequestRepository(drizzleClient);
let injectedRepo: WaitlistRequestRepository | null = null;

export function setWaitlistRepoForTests(repo: WaitlistRequestRepository): void {
  injectedRepo = repo;
}

function getRepo(): WaitlistRequestRepository {
  return injectedRepo ?? waitlistRepo;
}

export function buildWaitlistRouter(deps: { log: Logger }): Router {
  const waitlistRouter = new Router();

  waitlistRouter.post("/waitlist", async (ctx) => {
    const body = await ctx.request.body.json().catch(() => null);
    const email = body?.email;
    const walletPublicKey = body?.walletPublicKey ?? null;

    if (
      typeof email !== "string" || !EMAIL_RE.test(email) || email.length > 254
    ) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Invalid email" };
      return;
    }

    const { isNew } = await getRepo().upsert({
      email,
      walletPublicKey: typeof walletPublicKey === "string"
        ? walletPublicKey
        : null,
      source: SOURCE,
    });

    notifyDiscord(email, walletPublicKey, SOURCE, deps);

    ctx.response.status = isNew ? Status.Created : Status.OK;
    ctx.response.body = { message: "Added to waitlist" };
  });

  return waitlistRouter;
}
