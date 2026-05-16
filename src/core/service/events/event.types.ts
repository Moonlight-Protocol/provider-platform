/**
 * Provider event taxonomy emitted onto the in-process event bus and surfaced
 * to subscribers of the /api/v1/events/ws WebSocket endpoint.
 *
 * Scope.ppPublicKey is the stable filter key; ppLabel is the human-readable
 * name (may be null when the operator has not set one).
 */
export type EventScope = {
  ppPublicKey: string;
  ppLabel: string | null;
};

export type MempoolBundleAddedPayload = {
  bundleId: string;
  weight: number;
  channelContractId: string;
  newSlot: boolean;
};

export type MempoolBundleExpiredPayload = {
  bundleId: string;
  channelContractId: string;
};

export type ExecutorTransactionSubmittedPayload = {
  txHash: string;
  bundleIds: string[];
  channelContractId: string;
};

export type ExecutorExecutionFailedPayload = {
  bundleIds: string[];
  channelContractId: string | null;
  reason: string;
};

export type VerifierBundleCompletedPayload = {
  txId: string;
  bundleIds: string[];
  channelContractId: string;
};

export type VerifierBundleFailedPayload = {
  txId: string;
  bundleIds: string[];
  channelContractId: string;
  reason: string;
};

export type ChannelEventPayload = {
  channelContractId: string;
};

export type BundleDepositCompletedPayload = {
  bundleId: string;
  txId: string;
  channelContractId: string;
  /** The depositor's real Stellar address (extracted from the DepositOperation). */
  depositorAddress: string;
  /** Amount deposited, in stroops. */
  amount: string;
};

export type BundleWithdrawCompletedPayload = {
  bundleId: string;
  txId: string;
  channelContractId: string;
  /** The recipient's real Stellar address (extracted from the WithdrawOperation). */
  recipientAddress: string;
  /** Amount withdrawn, in stroops. */
  amount: string;
};

export type ProviderEvent =
  | {
    kind: "mempool.bundle_added";
    ts: number;
    scope: EventScope;
    payload: MempoolBundleAddedPayload;
  }
  | {
    kind: "mempool.bundle_expired";
    ts: number;
    scope: EventScope;
    payload: MempoolBundleExpiredPayload;
  }
  | {
    kind: "executor.transaction_submitted";
    ts: number;
    scope: EventScope;
    payload: ExecutorTransactionSubmittedPayload;
  }
  | {
    kind: "executor.execution_failed";
    ts: number;
    scope: EventScope;
    payload: ExecutorExecutionFailedPayload;
  }
  | {
    kind: "verifier.bundle_completed";
    ts: number;
    scope: EventScope;
    payload: VerifierBundleCompletedPayload;
  }
  | {
    kind: "verifier.bundle_failed";
    ts: number;
    scope: EventScope;
    payload: VerifierBundleFailedPayload;
  }
  | {
    kind: "channel.provider_added";
    ts: number;
    scope: EventScope;
    payload: ChannelEventPayload;
  }
  | {
    kind: "channel.provider_removed";
    ts: number;
    scope: EventScope;
    payload: ChannelEventPayload;
  }
  | {
    kind: "bundle.deposit_completed";
    ts: number;
    scope: EventScope;
    payload: BundleDepositCompletedPayload;
  }
  | {
    kind: "bundle.withdraw_completed";
    ts: number;
    scope: EventScope;
    payload: BundleWithdrawCompletedPayload;
  };

export type ProviderEventKind = ProviderEvent["kind"];
