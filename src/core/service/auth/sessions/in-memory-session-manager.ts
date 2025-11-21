import { SESSION_TTL } from "@/config/env.ts";
import { memDb } from "@/persistence/kv/config.ts";
import type { Session } from "@/models/auth/session/session.model.ts";

class InMemorySessionManager {
  public async addSession(
    txHash: string,
    clientAccount: string,
    requestId: string,
    expiresAt: Date
  ): Promise<void> {
    console.log(`Adding session to store: ${txHash}`);
    console.log(`Entries: ${await memDb.countAll()}`);

    const cr = await memDb.sessions.add({
      txHash,
      clientAccount,
      requestId,
      expiresAt,
      status: "PENDING",
    });

    if (cr.ok) {
      console.log("session added to store");
      console.log(`Entries: ${await memDb.countAll()}`);
    }
  }

  public async getSession(txHash: string): Promise<Session | undefined> {
    const session = await memDb.sessions.findByPrimaryIndex("txHash", txHash);
    if (session && Date.now() < session.value.expiresAt.getTime()) {
      return session.value;
    }
    await memDb.sessions.delete(txHash);
    return undefined;
  }

  public async updateSession(session: Session): Promise<void> {
    if (!(await this.getSession(session.txHash))) {
      throw new Error(`Session with id ${session.txHash} not found or expired`);
    }

    await memDb.sessions.update(session.txHash, session);
  }

  public async cleanupExpired(): Promise<void> {
    const now = Date.now();

    console.log(`Cleaning expired sessions`);
    console.log(`Entries B4: ${await memDb.countAll()}`);

    const cursor = await memDb.sessions.deleteMany({
      filter: (doc) => doc.value.expiresAt.getTime() < now,
    });

    console.log(`Cursor ${cursor}`);
    console.log(`Entries AFTER: ${await memDb.countAll()}`);
  }
}

export const sessionManager = new InMemorySessionManager();

// Schedule cleanup every session TTL period
setInterval(() => sessionManager.cleanupExpired(), SESSION_TTL * 1000);
