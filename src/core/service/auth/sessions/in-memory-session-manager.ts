import { SESSION_TTL } from "@/config/env.ts";
import { memDb } from "@/persistence/kv/config.ts";
import type { Session } from "@/models/auth/session/session.model.ts";
import type { Logger } from "@/utils/logger/index.ts";

export class InMemorySessionManager {
  private log: Logger;

  constructor(deps: { log: Logger }) {
    this.log = deps.log.scope("InMemorySessionManager");
  }

  public async addSession(
    txHash: string,
    clientAccount: string,
    requestId: string,
    expiresAt: Date,
  ): Promise<void> {
    this.log.info("addSession");
    this.log.debug("txHash", txHash);

    const cr = await memDb.sessions.add({
      txHash,
      clientAccount,
      requestId,
      expiresAt,
      status: "PENDING",
    });

    if (cr.ok) {
      this.log.event("session added to store");
    }
  }

  public async getSession(txHash: string): Promise<Session | undefined> {
    this.log.info("getSession");
    this.log.debug("txHash", txHash);

    this.log.event("looking up session by txHash");
    const session = await memDb.sessions.findByPrimaryIndex("txHash", txHash);
    if (session && Date.now() < session.value.expiresAt.getTime()) {
      this.log.event("session found and valid");
      return session.value;
    }
    this.log.event("session missing or expired, deleting");
    await memDb.sessions.delete(txHash);
    return undefined;
  }

  public async updateSession(session: Session): Promise<void> {
    this.log.info("updateSession");
    this.log.debug("txHash", session.txHash);

    if (!(await this.getSession(session.txHash))) {
      const err = new Error(
        `Session with id ${session.txHash} not found or expired`,
      );
      this.log.error(err, "cannot update missing session");
      throw err;
    }

    this.log.event("persisting session update");
    await memDb.sessions.update(session.txHash, session);
  }

  public async cleanupExpired(): Promise<void> {
    const now = Date.now();

    this.log.info("cleanupExpired");

    await memDb.sessions.deleteMany({
      filter: (doc) => doc.value.expiresAt.getTime() < now,
    });

    this.log.event("expired sessions cleaned");
  }
}

let _sessionManager: InMemorySessionManager | null = null;
let _cleanupInterval: number | null = null;

/**
 * Lazy singleton accessor. The first caller wires up the logger and starts
 * the cleanup interval; subsequent callers get the same instance.
 */
export function getSessionManager(
  deps: { log: Logger },
): InMemorySessionManager {
  if (!_sessionManager) {
    _sessionManager = new InMemorySessionManager(deps);
    _cleanupInterval = setInterval(
      () => _sessionManager!.cleanupExpired(),
      SESSION_TTL * 1000,
    ) as unknown as number;
  }
  return _sessionManager;
}

/** Test helper / shutdown — clear the singleton and stop the cleanup interval. */
export function _resetSessionManagerForTests(): void {
  if (_cleanupInterval !== null) {
    clearInterval(_cleanupInterval);
    _cleanupInterval = null;
  }
  _sessionManager = null;
}
