export type SessionData = {
  expiresAt: Date;
  status: SessionStatus;
  requestId: string;
};

export type SessionKey = string; // challenge tx hash

export enum SessionStatus {
  PENDING = "pending",
  ACTIVE = "active",
}
