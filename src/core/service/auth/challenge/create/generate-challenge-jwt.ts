import { type MetadataHelper, ProcessEngine } from "@fifo/convee";
import { Transaction } from "stellar-sdk";
import { NETWORK_CONFIG } from "@/config/env.ts";
import type {
  PostChallengeInput,
  PostChallengeWithJWT,
} from "@/core/service/auth/challenge/types.ts";
import generateJwt from "@/core/service/auth/generate-jwt.ts";
import * as E from "@/core/service/auth/challenge/create/error.ts";
import { assertOrThrow } from "@/utils/error/assert-or-throw.ts";
import { isDefined } from "@/utils/type-guards/is-defined.ts";
import { withSpan } from "@/core/tracing.ts";
import type { Logger } from "@/utils/logger/index.ts";

export const P_GenerateChallengeJWT = (deps: { log: Logger }) =>
  ProcessEngine.create(
    (
      input: PostChallengeInput,
      _metadataHelper?: MetadataHelper,
    ): Promise<PostChallengeWithJWT> => {
      return withSpan("P_GenerateChallengeJWT", async (span) => {
        const log = deps.log.scope("P_GenerateChallengeJWT");
        log.info("P_GenerateChallengeJWT");

        const { signedChallenge } = input.body;
        const tx = new Transaction(
          signedChallenge,
          NETWORK_CONFIG.networkPassphrase,
        );

        const key = tx.hash().toString("hex");
        log.debug("txHash", key);

        const clientAccount = tx.operations[0].source;
        assertOrThrow(isDefined(clientAccount), new E.MISSING_CLIENT_ACCOUNT());
        log.debug("clientAccount", clientAccount);

        span.addEvent("generating_jwt", { "client.account": clientAccount });
        log.event("generating JWT");
        const jwt = await generateJwt(clientAccount, key);
        span.addEvent("jwt_generated");
        log.event("JWT generated");

        return {
          ctx: input.ctx,
          body: input.body,
          jwt,
        };
      });
    },
    {
      name: "GenerateChallengeJWT",
    },
  );
