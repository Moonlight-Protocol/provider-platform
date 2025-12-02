import { ProcessEngine } from "@fifo/convee";
import { Transaction, Keypair } from "stellar-sdk";
import { PROVIDER_ACCOUNT } from "@/core/service/auth/service/service-account.ts";
import { NETWORK_CONFIG, SERVICE_DOMAIN } from "@/config/env.ts";
import type { PostChallengeInput } from "@/core/service/auth/challenge/types.ts";
import { LOG } from "@/config/logger.ts";

export const P_VerifyChallenge = ProcessEngine.create(
  (input: PostChallengeInput): PostChallengeInput => {
    const { signedChallenge } = input.body;
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
        if (
          PROVIDER_ACCOUNT.verifySignature(
            // deno-lint-ignore no-explicit-any
            tx.hash() as any, // Forcing type to Buffer as there seems to be an issue with the lib type inference
            // deno-lint-ignore no-explicit-any
            sig.signature() as any // Forcing type to Buffer as there seems to be an issue with the lib type inference
          )
        ) {
          isSignedByServer = true;
        }
        if (clientKeypair.verify(tx.hash(), sig.signature())) {
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
      LOG.error("Challenge verification error:", (error as Error).message);
      throw new Error("Challenge verification failed");
    }
  },
  {
    name: "VerifyChallengeProcessEngine",
  }
);
