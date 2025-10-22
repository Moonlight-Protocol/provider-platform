import { ProcessEngine } from "@fifo/convee";
import { Transaction, Keypair } from "stellar-sdk";
import { PROVIDER_ACCOUNT } from "../service/service-account.ts";
import { NETWORK_CONFIG, SERVICE_DOMAIN } from "../../../config/env.ts";
import { ContextWithParsedPayload } from "../../../api/utils/parse-request-payload.ts";
import { PostAuthPayload } from "../../../api/v1/stellar/auth/post.schema.ts";

export type VerifyChallengeInput = ContextWithParsedPayload<PostAuthPayload>;
export type VerifyChallengeOutput = VerifyChallengeInput;

export const VERIFY_CHALLENGE_PROCESS = ProcessEngine.create(
  async (input: VerifyChallengeInput): Promise<VerifyChallengeOutput> => {
    const { signedChallenge } = input.payload;
    try {
      const tx = new Transaction(
        signedChallenge,
        NETWORK_CONFIG.networkPassphrase
      );

      if (tx.sequence !== "0") {
        throw new Error("Invalid challenge: sequence number is not 0");
      }

      if (!tx.timeBounds) {
        throw new Error("Invalid challenge: missing time bounds");
      }

      if (!tx.operations || tx.operations.length === 0) {
        throw new Error("Invalid challenge: no operations present");
      }

      const firstOp = tx.operations[0];
      if (firstOp.type !== "manageData") {
        throw new Error("Invalid challenge: first operation is not manageData");
      }

      if (!firstOp.name.startsWith(`${SERVICE_DOMAIN} auth`)) {
        throw new Error(
          "Invalid challenge: operation key does not match expected format"
        );
      }

      const currentTime = Math.floor(Date.now() / 1000);
      const minTime = tx.timeBounds.minTime
        ? parseInt(tx.timeBounds.minTime)
        : 0;
      const maxTime = tx.timeBounds.maxTime
        ? parseInt(tx.timeBounds.maxTime)
        : 0;

      if (currentTime < minTime) {
        throw new Error("Challenge is not yet valid");
      }
      if (currentTime > maxTime) {
        throw new Error("Challenge has expired");
      }

      const clientPublicKey = firstOp.source;
      if (!clientPublicKey || clientPublicKey.length === 0) {
        throw new Error("Invalid challenge: missing client public key");
      }

      const clientKeypair = Keypair.fromPublicKey(clientPublicKey);

      let isSignedByServer = false;
      let isSignedByClient = false;

      for (const sig of tx.signatures) {
        if (PROVIDER_ACCOUNT.verifySignature(tx.hash(), sig.signature())) {
          isSignedByServer = true;
        }
        if (clientKeypair.verifySignature(tx.hash(), sig.signature())) {
          isSignedByClient = true;
        }
      }
      if (!isSignedByServer) {
        throw new Error("Invalid challenge: not signed by the server");
      }
      if (!isSignedByClient) {
        throw new Error("Invalid challenge: not signed by the client");
      }

      return input;
    } catch (error) {
      console.error(error);
      throw new Error("Challenge verification failed");
    }
  },
  {
    name: "VerifyChallengeProcessEngine",
  }
);
