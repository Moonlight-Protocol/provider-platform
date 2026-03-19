import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PayCustodialAccountRepository } from "@/persistence/drizzle/repository/pay-custodial-account.repository.ts";
import generateJwt from "@/core/service/auth/generate-jwt.ts";
import { LOG } from "@/config/logger.ts";

const accountRepo = new PayCustodialAccountRepository(drizzleClient);

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  // Use Web Crypto for password verification (PBKDF2)
  const [salt, stored] = hash.split(":");
  if (!salt || !stored) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: new Uint8Array(hexToBytes(salt)).buffer, iterations: 100000, hash: "SHA-256" },
    key,
    256,
  );
  return bytesToHex(new Uint8Array(derived)) === stored;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

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

    const token = await generateJwt(account.id, crypto.randomUUID());

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
