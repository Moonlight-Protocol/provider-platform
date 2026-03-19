import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PayCustodialAccountRepository } from "@/persistence/drizzle/repository/pay-custodial-account.repository.ts";
import generateJwt from "@/core/service/auth/generate-jwt.ts";
import { LOG } from "@/config/logger.ts";

const accountRepo = new PayCustodialAccountRepository(drizzleClient);

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt.buffer, iterations: 100000, hash: "SHA-256" },
    key,
    256,
  );
  return `${bytesToHex(salt)}:${bytesToHex(new Uint8Array(derived))}`;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateDepositAddress(): string {
  // Generate a random Stellar-format address for deposit purposes.
  // In production, this would derive from the PP's key hierarchy.
  // For now, use a deterministic placeholder.
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const hex = bytesToHex(bytes).toUpperCase();
  return `G${hex.slice(0, 55)}`;
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
      ctx.response.status = Status.Conflict;
      ctx.response.body = { message: "Username already taken" };
      return;
    }

    const passwordHash = await hashPassword(password);
    const depositAddress = generateDepositAddress();
    const accountId = crypto.randomUUID();

    await accountRepo.create({
      id: accountId,
      username,
      passwordHash,
      depositAddress,
      balance: 0n,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const token = await generateJwt(accountId, crypto.randomUUID());

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
