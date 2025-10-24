import { ProcessEngine } from "@fifo/convee";
import { PROVIDER_ACCOUNT } from "../service/service-account.ts";
import getBase64Nonce from "../../../utils/rand/getBase64Nonce.ts";
import {
  Account,
  Operation,
  type Transaction,
  TransactionBuilder,
} from "stellar-sdk";
import {
  CHALLENGE_TTL,
  NETWORK_CONFIG,
  SERVICE_DOMAIN,
} from "../../../config/env.ts";
import type { ContextWithParsedQuery } from "../../../api/utils/parse-request-query.ts";
import type { GetAuthPayload } from "../../../api/v1/stellar/auth/get.schema.ts";
import { extractRequestMetadata } from "../../../api/utils/extract-request-metadata.ts";
import type { Context } from "@oak/oak";
import { isTransaction } from "@colibri/core";

export type CreateChallengeOutput = {
  ctx: Context;
  challengeData: {
    txHash: string;
    clientAccount: string;
    xdr: string;
    nonce: string;
    dateCreated: Date;
    requestId: string;
    clientIp: string;
    userAgent: string;
    expiresAt: Date;
  };
};

export type CreateChallengeInput = ContextWithParsedQuery<GetAuthPayload>;

// const homeDomain = "example.com";
//   const challengeValiditySeconds = 900; // 15 minutes
//   const serverKeypair = STELLAR_SERVICE_ACCOUNT;

export const CREATE_CHALLENGE_PROCESS = ProcessEngine.create(
  async (input: CreateChallengeInput) => {
    const { ctx, query } = input;
    const clientAccount = query.account;
    if (!clientAccount) {
      throw new Error("Missing account in query parameters");
    }
    try {
      const { tx, nonce, minTime, maxTime } =
        getChallengeTransaction(clientAccount);

      const xdr = tx.toXDR();
      const txHash = tx.hash().toString("hex");

      const dateCreated = new Date(minTime * 1000);
      const expiresAt = new Date(maxTime * 1000);

      const { clientIp, userAgent, requestId } = extractRequestMetadata(ctx);

      const output: CreateChallengeOutput = {
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
      console.error("Error creating challenge: ", error);
      throw new Error("Error creating challenge");
    }
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

  if (!isTransaction(signedTxObj)) {
    throw new Error("Signed transaction is not a valid Transaction object");
  }

  return { tx: signedTxObj, nonce: nonceBase64, minTime, maxTime };
};
