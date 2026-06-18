import { SESSION_TTL } from "@/config/env.ts";
import type { Session } from "@/models/auth/session/session.model.ts";
import type { Logger } from "@/utils/logger/index.ts";

/**
 * Live store of in-flight handshake sessions, keyed by challenge tx hash.
 *
 * Truly in-memory (a plain Map) — these are short-TTL auth handshakes, not
 * derived state, so there is no benefit to persisting them. A machine
 * stop/redeploy clears them and the client simply re-authenticates. Nothing
 * here touches disk or Deno.KV.
 */
export class InMemorySessionManager {
  private sessions: Map<string, Session> = new Map();
  private log: Logger;

  constructor(deps: { log: Logger }) {
    this.log = deps.log.scope("InMemorySessionManager");
  }

  // deno-lint-ignore require-await -- async to preserve the manager's contract
  public async addSession(
    txHash: string,
    clientAccount: string,
    requestId: string,
    expiresAt: Date,
  ): Promise<void> {
    this.log.info("addSession");
    this.log.debug("txHash", txHash);

    this.sessions.set(txHash, {
      txHash,
      clientAccount,
      requestId,
      expiresAt,
      status: "PENDING",
    });

    this.log.event("session added to store");
  }

  // deno-lint-ignore require-await -- async to preserve the manager's contract
  public async getSession(txHash: string): Promise<Session | undefined> {
    this.log.info("getSession");
    this.log.debug("txHash", txHash);

    this.log.event("looking up session by txHash");
    const session = this.sessions.get(txHash);
    if (session && Date.now() < session.expiresAt.getTime()) {
      this.log.event("session found and valid");
      return session;
    }
    this.log.event("session missing or expired, deleting");
    this.sessions.delete(txHash);
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
    this.sessions.set(session.txHash, session);
  }

  // deno-lint-ignore require-await -- async to preserve the manager's contract
  public async cleanupExpired(): Promise<void> {
    const now = Date.now();

    this.log.info("cleanupExpired");

    for (const [txHash, session] of this.sessions) {
      if (session.expiresAt.getTime() < now) {
        this.sessions.delete(txHash);
      }
    }

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
