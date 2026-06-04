import { decode as decodeJwt } from "@zaubrik/djwt";
import { type MetadataHelper, ProcessEngine } from "@fifo/convee";
import { PpRepository } from "@/persistence/drizzle/repository/pp.repository.ts";
import { PpEntityApprovalRepository } from "@/persistence/drizzle/repository/pp-entity-approval.repository.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { EntityStatus } from "@/persistence/drizzle/entity/entity.entity.ts";
import type {
  ContextWithJWTAndPpPublicKey,
  ContextWithJWTAndStatus,
} from "@/core/service/auth/challenge/types.ts";
import type { Logger } from "@/utils/logger/index.ts";
import { withSpan } from "@/core/tracing.ts";

const ppRepository = new PpRepository(drizzleClient);
const ppEntityApprovalRepository = new PpEntityApprovalRepository(
  drizzleClient,
);

// SEP-10 verify is PP-aware: the wallet posts `ppPublicKey` alongside the
// signed challenge, and this step reports the submitter's per-PP entity
// status + the operator-configured KYC submission URL for that PP. A wallet
// APPROVED on PP-A must not appear APPROVED on PP-B.
export const P_AttachEntityStatus = (deps: { log: Logger }) =>
  ProcessEngine.create(
    (
      input: ContextWithJWTAndPpPublicKey,
      _metadataHelper?: MetadataHelper,
    ): Promise<ContextWithJWTAndStatus> => {
      return withSpan("P_AttachEntityStatus", async (span) => {
        const log = deps.log.scope("P_AttachEntityStatus");

        const { ppPublicKey } = input;
        const [, payload] = decodeJwt(input.jwt);
        const accountPubkey = (payload as { sub?: string }).sub;

        const make = (
          entityStatus: EntityStatus,
          kycSubmissionUrl: string | null,
        ): ContextWithJWTAndStatus => ({
          ctx: input.ctx,
          jwt: input.jwt,
          entityStatus,
          kycSubmissionUrl,
        });

        if (!accountPubkey) {
          log.event("no sub on JWT; reporting UNVERIFIED + null URL");
          return make(EntityStatus.UNVERIFIED, null);
        }

        span.addEvent("loading_pp", { "pp.public_key": ppPublicKey });
        const pp = await ppRepository.findByPublicKey(ppPublicKey);
        if (!pp) {
          log.event("pp not found; reporting UNVERIFIED + null URL");
          return make(EntityStatus.UNVERIFIED, null);
        }
        const kycSubmissionUrl = pp.kycSubmissionUrl ?? null;

        const approval = await ppEntityApprovalRepository.findByPpAndAccount(
          ppPublicKey,
          accountPubkey,
        );
        const entityStatus = approval?.status ?? EntityStatus.UNVERIFIED;
        span.addEvent("entity_status_attached", {
          "entity.status": entityStatus,
          "pp.has_kyc_url": String(kycSubmissionUrl !== null),
        });
        return make(entityStatus, kycSubmissionUrl);
      });
    },
    {
      name: "AttachEntityStatus",
    },
  );
