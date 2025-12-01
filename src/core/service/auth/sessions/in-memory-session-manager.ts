import { SESSION_TTL } from "@/config/env.ts";
import { memDb } from "@/persistence/kv/config.ts";
import type { Session } from "@/models/auth/session/session.model.ts";
import { LOG } from "@/config/logger.ts";

class InMemorySessionManager {
  public async addSession(
    txHash: string,
    clientAccount: string,
    requestId: string,
    expiresAt: Date
  ): Promise<void> {
    LOG.debug(`Adding session to store: ${txHash}`);
    LOG.debug(`Entries: ${await memDb.countAll()}`);

    const cr = await memDb.sessions.add({
      txHash,
      clientAccount,
      requestId,
      expiresAt,
      status: "PENDING",
    });

    if (cr.ok) {
      LOG.info("session", { txHash }, "added to store");
      LOG.debug("Entries:", await memDb.countAll());
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

    LOG.debug(`Cleaning expired sessions`);
    LOG.debug("Entries B4:", await memDb.countAll());

    const cursor = await memDb.sessions.deleteMany({
      filter: (doc) => doc.value.expiresAt.getTime() < now,
    });

    LOG.debug("Cursor", cursor);
    LOG.debug("Entries AFTER:", await memDb.countAll());
  }
}

export const sessionManager = new InMemorySessionManager();

// Schedule cleanup every session TTL period
setInterval(() => sessionManager.cleanupExpired(), SESSION_TTL * 1000);
