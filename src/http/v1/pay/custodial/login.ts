import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PayCustodialAccountRepository } from "@/persistence/drizzle/repository/pay-custodial-account.repository.ts";
import { PayCustodialStatus } from "@/persistence/drizzle/entity/pay-custodial-account.entity.ts";
import generateJwt from "@/core/service/auth/generate-jwt.ts";
import { LOG } from "@/config/logger.ts";
import { verifyPassword } from "@/http/v1/pay/custodial/crypto.ts";

const accountRepo = new PayCustodialAccountRepository(drizzleClient);

export const postCustodialLoginHandler = async (ctx: Context) => {
  try {
    const body = await ctx.request.body.json();
    const { username, password } = body;

    if (!username || !password) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "username and password are required" };
      return;
    }

    const account = await accountRepo.findByUsername(username);
    if (!account) {
      ctx.response.status = Status.Unauthorized;
      ctx.response.body = { message: "Invalid credentials" };
      return;
    }

    const valid = await verifyPassword(password, account.passwordHash);
    if (!valid) {
      ctx.response.status = Status.Unauthorized;
      ctx.response.body = { message: "Invalid credentials" };
      return;
    }

    // Check suspended AFTER password verification to avoid leaking account status
    if (account.status === PayCustodialStatus.SUSPENDED) {
      ctx.response.status = Status.Forbidden;
      ctx.response.body = { message: "Account suspended" };
      return;
    }

    const token = await generateJwt(account.id, crypto.randomUUID(), { type: "custodial" });

    LOG.info("Custodial login successful", { username });

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Login successful",
      data: { token },
    };
  } catch {
    ctx.response.status = Status.BadRequest;
    ctx.response.body = { message: "Invalid request body" };
  }
};
