import { ProcessEngine } from "@fifo/convee";
import { isTransaction } from "@colibri/core";
import { PROVIDER_ACCOUNT } from "@/core/service/auth/service/service-account.ts";
import getBase64Nonce from "@/utils/rand/getBase64Nonce.ts";
import {
  Account,
  Operation,
  type Transaction,
  TransactionBuilder,
} from "stellar-sdk";
import { CHALLENGE_TTL, NETWORK_CONFIG, SERVICE_DOMAIN } from "@/config/env.ts";
import { extractRequestMetadata } from "@/http/utils/extract-request-metadata.ts";
import type {
  GetChallengeInput,
  ChallengeData,
} from "@/core/service/auth/challenge/types.ts";
import { assertOrThrow } from "@/utils/error/assert-or-throw.ts";
import { isDefined } from "@/utils/type-guards/is-defined.ts";
import * as E from "@/core/service/auth/challenge/create/error.ts";
import { logAndThrow } from "@/utils/error/log-and-throw.ts";
import { withSpan } from "@/core/tracing.ts";

export const P_CreateChallenge = ProcessEngine.create(
  async (input: GetChallengeInput): Promise<ChallengeData> => {
    return withSpan("P_CreateChallenge", async (span) => {
      const { ctx, query } = input;
      const clientAccount = query.account;

      span.addEvent("validating_client_account", { "client.account": clientAccount ?? "undefined" });
      assertOrThrow(isDefined(clientAccount), new E.MISSING_CLIENT_ACCOUNT());

      try {
        span.addEvent("building_challenge_transaction");
        const { tx, nonce, minTime, maxTime } =
          getChallengeTransaction(clientAccount);

        const xdr = tx.toXDR();
        const txHash = tx.hash().toString("hex");

        const dateCreated = new Date(minTime * 1000);
        const expiresAt = new Date(maxTime * 1000);

        const { clientIp, userAgent, requestId } = extractRequestMetadata(ctx);

        span.addEvent("challenge_created", {
          "challenge.txHash": txHash,
          "challenge.clientAccount": clientAccount,
          "challenge.requestId": requestId,
        });

        const output: ChallengeData = {
          ctx,
          challengeData: {
            txHash: txHash,
            clientAccount: clientAccount,
            xdr,
            nonce,
            dateCreated: dateCreated,
            requestId,
            clientIp,
            userAgent,
            expiresAt,
          },
        };

        return await output;
      } catch (error) {
        span.addEvent("challenge_creation_failed", {
          "error.message": error instanceof Error ? error.message : String(error),
        });
        logAndThrow(new E.FAILED_TO_CREATE_CHALLENGE(error));
      }
    });
  },
  {
    name: "CreateChallengeProcessEngine",
  }
);

const getChallengeTransaction = (
  clientAccount: string
): {
  tx: Transaction;
  nonce: string;
  minTime: number;
  maxTime: number;
} => {
  const nonceBase64 = getBase64Nonce(32);

  const now = Math.floor(Date.now() / 1000);
  const minTime = now;
  const maxTime = now + CHALLENGE_TTL;

  const op = Operation.manageData({
    source: clientAccount,
    name: `${SERVICE_DOMAIN} auth`,
    value: nonceBase64,
  });

  const providerAccount = new Account(PROVIDER_ACCOUNT.publicKey(), "-1");

  const txBuilder = new TransactionBuilder(providerAccount, {
    timebounds: { minTime: minTime.toString(), maxTime: maxTime.toString() },
    networkPassphrase: NETWORK_CONFIG.networkPassphrase,
    fee: "0",
  });

  txBuilder.addOperation(op);
  const builtTx = txBuilder.build();

  const signedTx = PROVIDER_ACCOUNT.signTransaction(builtTx);
  const signedTxObj = TransactionBuilder.fromXDR(
    signedTx,
    NETWORK_CONFIG.networkPassphrase
  );

  assertOrThrow(
    isTransaction(signedTxObj),
    new E.INVALID_SIGNED_TRANSACTION_OBJ(signedTxObj)
  );

  return { tx: signedTxObj, nonce: nonceBase64, minTime, maxTime };
};
