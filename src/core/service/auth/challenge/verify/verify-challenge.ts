import { ProcessEngine } from "@fifo/convee";
import { Transaction, Keypair, type OperationType } from "stellar-sdk";
import { getProviderAccount } from "@/core/service/auth/service/service-account.ts";
import { NETWORK_CONFIG, SERVICE_DOMAIN } from "@/config/env.ts";
import type { PostChallengeInput } from "@/core/service/auth/challenge/types.ts";
import * as E from "@/core/service/auth/challenge/verify/error.ts";
import { assertOrThrow } from "@/utils/error/assert-or-throw.ts";
import { isDefined } from "@/utils/type-guards/is-defined.ts";
import { StrKey } from "@colibri/core";
import { logAndThrow } from "@/utils/error/log-and-throw.ts";
import { withSpan } from "@/core/tracing.ts";

export const P_VerifyChallenge = ProcessEngine.create(
  (input: PostChallengeInput): Promise<PostChallengeInput> => {
    return withSpan("P_VerifyChallenge", (span) => {
      const { signedChallenge } = input.body;
      try {
        span.addEvent("deserializing_transaction");
        const tx = new Transaction(
          signedChallenge,
          NETWORK_CONFIG.networkPassphrase
        );

        span.addEvent("validating_sequence_number");
        assertOrThrow(
          tx.sequence === "0",
          new E.INVALID_SEQUENCE_NUMBER(tx.sequence)
        );

        assertOrThrow(isDefined(tx.timeBounds), new E.MISSING_TIME_BOUNDS());

        assertOrThrow(
          isDefined(tx.operations && tx.operations.length > 0),
          new E.MISSING_OPERATIONS(tx)
        );

        const firstOp = tx.operations[0];

        const expectedOperationType = "manageData" as OperationType.ManageData;
        assertOrThrow(
          firstOp.type === expectedOperationType,
          new E.WRONG_OPERATION_TYPE(expectedOperationType, firstOp.type)
        );

        assertOrThrow(
          firstOp.name.startsWith(`${SERVICE_DOMAIN} auth`),
          new E.OPERATION_KEY_MISMATCH(`${SERVICE_DOMAIN} auth`, firstOp.name)
        );

        span.addEvent("validating_timebounds");
        const currentTime = Math.floor(Date.now() / 1000);
        const minTime = tx.timeBounds.minTime
          ? parseInt(tx.timeBounds.minTime)
          : 0;
        const maxTime = tx.timeBounds.maxTime
          ? parseInt(tx.timeBounds.maxTime)
          : 0;

        assertOrThrow(
          currentTime >= minTime,
          new E.CHALLENGE_TOO_EARLY(currentTime, minTime)
        );
        assertOrThrow(
          currentTime <= maxTime,
          new E.CHALLENGE_EXPIRED(currentTime, maxTime)
        );

        const clientPublicKey = firstOp.source;

        assertOrThrow(
          isDefined(clientPublicKey) &&
            StrKey.isEd25519PublicKey(clientPublicKey),
          new E.MISSING_CLIENT_ACCOUNT()
        );

        span.addEvent("verifying_signatures", { "client.publicKey": clientPublicKey });
        const clientKeypair = Keypair.fromPublicKey(clientPublicKey);

        let isSignedByServer = false;
        let isSignedByClient = false;

        for (const sig of tx.signatures) {
          if (
            getProviderAccount().verifySignature(
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

        span.addEvent("signature_verification_result", {
          "signatures.server": isSignedByServer,
          "signatures.client": isSignedByClient,
        });

        assertOrThrow(isSignedByServer, new E.MISSING_SERVER_SIGNATURE());
        assertOrThrow(isSignedByClient, new E.MISSING_CLIENT_SIGNATURE());

        return input;
      } catch (error) {
        span.addEvent("verification_failed", {
          "error.message": error instanceof Error ? error.message : String(error),
        });
        logAndThrow(new E.CHALLENGE_VERIFICATION_FAILED(error));
      }
    });
  },
  {
    name: "VerifyChallengeProcessEngine",
  }
);
