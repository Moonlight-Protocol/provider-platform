import { Router, Status } from "@oak/oak";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const waitlistRouter = new Router();

waitlistRouter.post("/waitlist", async (ctx) => {
  const body = await ctx.request.body.json().catch(() => null);
  const email = body?.email;
  const walletPublicKey = body?.walletPublicKey;

  if (
    typeof email !== "string" || !EMAIL_RE.test(email) || email.length > 254
  ) {
    ctx.response.status = Status.BadRequest;
    ctx.response.body = { message: "Invalid email" };
    return;
  }

  console.log(
    `[waitlist] ${email}${walletPublicKey ? ` (${walletPublicKey})` : ""}`,
  );

  ctx.response.status = Status.OK;
  ctx.response.body = { message: "Added to waitlist" };
});

export default waitlistRouter;
