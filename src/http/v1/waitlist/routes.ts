import { Router, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { WaitlistRequestRepository } from "@/persistence/drizzle/repository/waitlist-request.repository.ts";
import { notifyDiscord } from "@/http/v1/waitlist/discord-notify.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SOURCE = "provider-console";

const waitlistRepo = new WaitlistRequestRepository(drizzleClient);

const waitlistRouter = new Router();

/** Allow tests to inject a different repository instance. */
export function setWaitlistRepoForTests(repo: WaitlistRequestRepository): void {
  Object.assign(waitlistRouter, { _repo: repo });
}

function getRepo(): WaitlistRequestRepository {
  return (waitlistRouter as unknown as { _repo?: WaitlistRequestRepository })._repo ?? waitlistRepo;
}

waitlistRouter.post("/waitlist", async (ctx) => {
  const body = await ctx.request.body.json().catch(() => null);
  const email = body?.email;
  const walletPublicKey = body?.walletPublicKey ?? null;

  if (typeof email !== "string" || !EMAIL_RE.test(email) || email.length > 254) {
    ctx.response.status = Status.BadRequest;
    ctx.response.body = { message: "Invalid email" };
    return;
  }

  const { isNew } = await getRepo().upsert({
    email,
    walletPublicKey: typeof walletPublicKey === "string" ? walletPublicKey : null,
    source: SOURCE,
  });

  notifyDiscord(email, walletPublicKey, SOURCE);

  ctx.response.status = isNew ? Status.Created : Status.OK;
  ctx.response.body = { message: "Added to waitlist" };
});

export default waitlistRouter;
