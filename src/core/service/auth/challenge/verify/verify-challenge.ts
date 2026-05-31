import { ProcessEngine } from "@fifo/convee";
import { Keypair, type OperationType, Transaction } from "stellar-sdk";
import { getProviderAccount } from "@/core/service/auth/service/service-account.ts";
import { NETWORK_CONFIG, SERVICE_DOMAIN } from "@/config/env.ts";
import type { PostChallengeInput } from "@/core/service/auth/challenge/types.ts";
import * as E from "@/core/service/auth/challenge/verify/error.ts";
import { assertOrThrow } from "@/utils/error/assert-or-throw.ts";
import { isDefined } from "@/utils/type-guards/is-defined.ts";
import { StrKey } from "@colibri/core";
import { withSpan } from "@/core/tracing.ts";
import type { Logger } from "@/utils/logger/index.ts";

export const P_VerifyChallenge = (deps: { log: Logger }) =>
  ProcessEngine.create(
    (input: PostChallengeInput): Promise<PostChallengeInput> => {
      return withSpan("P_VerifyChallenge", (span) => {
        const log = deps.log.scope("P_VerifyChallenge");
        log.info("P_VerifyChallenge");
        const { signedChallenge } = input.body;
        try {
          span.addEvent("deserializing_transaction");
          log.event("deserializing transaction");
          const tx = new Transaction(
            signedChallenge,
            NETWORK_CONFIG.networkPassphrase,
          );

          span.addEvent("validating_sequence_number");
          log.event("validating sequence number");
          assertOrThrow(
            tx.sequence === "0",
            new E.INVALID_SEQUENCE_NUMBER(tx.sequence),
          );

          assertOrThrow(isDefined(tx.timeBounds), new E.MISSING_TIME_BOUNDS());

          assertOrThrow(
            isDefined(tx.operations && tx.operations.length > 0),
            new E.MISSING_OPERATIONS(tx),
          );

          const firstOp = tx.operations[0];

          const expectedOperationType =
            "manageData" as OperationType.ManageData;
          assertOrThrow(
            firstOp.type === expectedOperationType,
            new E.WRONG_OPERATION_TYPE(expectedOperationType, firstOp.type),
          );

          assertOrThrow(
            firstOp.name.startsWith(`${SERVICE_DOMAIN} auth`),
            new E.OPERATION_KEY_MISMATCH(
              `${SERVICE_DOMAIN} auth`,
              firstOp.name,
            ),
          );

          span.addEvent("validating_timebounds");
          log.event("validating timebounds");
          const currentTime = Math.floor(Date.now() / 1000);
          const minTime = tx.timeBounds.minTime
            ? parseInt(tx.timeBounds.minTime)
            : 0;
          const maxTime = tx.timeBounds.maxTime
            ? parseInt(tx.timeBounds.maxTime)
            : 0;

          assertOrThrow(
            currentTime >= minTime,
            new E.CHALLENGE_TOO_EARLY(currentTime, minTime),
          );
          assertOrThrow(
            currentTime <= maxTime,
            new E.CHALLENGE_EXPIRED(currentTime, maxTime),
          );

          const clientPublicKey = firstOp.source;

          assertOrThrow(
            isDefined(clientPublicKey) &&
              StrKey.isEd25519PublicKey(clientPublicKey),
            new E.MISSING_CLIENT_ACCOUNT(),
          );
          log.debug("clientPublicKey", clientPublicKey);

          span.addEvent("verifying_signatures", {
            "client.publicKey": clientPublicKey,
          });
          log.event("verifying signatures");
          const clientKeypair = Keypair.fromPublicKey(clientPublicKey);

          let isSignedByServer = false;
          let isSignedByClient = false;

          for (const sig of tx.signatures) {
            if (
              getProviderAccount().verifySignature(
                // deno-lint-ignore no-explicit-any
                tx.hash() as any,
                // deno-lint-ignore no-explicit-any
                sig.signature() as any,
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
          log.debug("signedByServer", isSignedByServer);
          log.debug("signedByClient", isSignedByClient);

          assertOrThrow(isSignedByServer, new E.MISSING_SERVER_SIGNATURE());
          assertOrThrow(isSignedByClient, new E.MISSING_CLIENT_SIGNATURE());
          log.event("challenge signatures valid");

          return input;
        } catch (error) {
          span.addEvent("verification_failed", {
            "error.message": error instanceof Error
              ? error.message
              : String(error),
          });
          log.error(error, "challenge verification failed");
          throw new E.CHALLENGE_VERIFICATION_FAILED(error);
        }
      });
    },
    {
      name: "VerifyChallengeProcessEngine",
    },
  );
