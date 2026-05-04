import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PayCustodialAccountRepository } from "@/persistence/drizzle/repository/pay-custodial-account.repository.ts";
import { Keypair } from "stellar-sdk";
import generateJwt from "@/core/service/auth/generate-jwt.ts";
import { LOG } from "@/config/logger.ts";
import { hashPassword } from "@/http/v1/pay/custodial/crypto.ts";

const accountRepo = new PayCustodialAccountRepository(drizzleClient);

function generateDepositAddress(): string {
  // Generate a valid Stellar public key as deposit address identifier.
  // NOTE: The secret key is intentionally discarded. In the current custodial model,
  // deposits are processed via the PP's OpEx/treasury account, not by signing
  // transactions from this address. This address is an identifier within the
  // privacy channel, not a funded on-chain account.
  // TODO: When implementing production ramp deposits, switch to memo-based routing
  // through the OpEx address (like Stellar custodial services), or store the
  // encrypted secret key if direct address funding is required.
  const keypair = Keypair.random();
  return keypair.publicKey();
}

export const postCustodialRegisterHandler = async (ctx: Context) => {
  try {
    const body = await ctx.request.body.json();
    const { username, password } = body;

    if (!username || !password) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "username and password are required" };
      return;
    }

    if (username.length < 3 || username.length > 50) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Username must be 3-50 characters" };
      return;
    }

    if (password.length < 8) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Password must be at least 8 characters" };
      return;
    }

    const existing = await accountRepo.findByUsername(username);
    if (existing) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Registration failed" };
      return;
    }

    const passwordHashValue = await hashPassword(password);
    const depositAddress = generateDepositAddress();
    const accountId = crypto.randomUUID();

    await accountRepo.create({
      id: accountId,
      username,
      passwordHash: passwordHashValue,
      depositAddress,
      balance: 0n,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const token = await generateJwt(accountId, crypto.randomUUID(), {
      type: "custodial",
    });

    LOG.info("Custodial account registered", { username });

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Account created",
      data: {
        token,
        depositAddress,
      },
    };
  } catch {
    ctx.response.status = Status.BadRequest;
    ctx.response.body = { message: "Invalid request body" };
  }
};
