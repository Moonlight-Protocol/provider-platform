import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { UtxoRepository } from "@/persistence/drizzle/repository/utxo.repository.ts";
import type { PaymentProvider } from "@/persistence/drizzle/entity/pp.entity.ts";
import type { Logger } from "@/utils/logger/index.ts";

const utxoRepo = new UtxoRepository(drizzleClient);

/**
 * GET /api/v1/providers/:ppPublicKey/utxos?channelContractId=C...
 *
 * Returns the currently-unspent UTXOs the provider has created in the given
 * privacy channel. PP comes from URL; channel still uses a query parameter
 * because it varies independently of the PP context.
 */
export function handleGetUtxos(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("getUtxos");

  return async (ctx) => {
    log.info("getUtxos");
    try {
      const _pp = ctx.state.pp as PaymentProvider;
      const channelContractId = ctx.request.url.searchParams.get(
        "channelContractId",
      );

      if (!channelContractId) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = {
          message: "channelContractId query parameter is required",
        };
        return;
      }

      const rows = await utxoRepo.findUnspentByChannel(channelContractId);

      ctx.response.status = Status.OK;
      ctx.response.body = {
        message: "UTXOs retrieved",
        data: rows.map((row) => ({
          id: row.id,
          amount: row.amount.toString(),
          createdAtBundleId: row.createdAtBundleId,
          createdAt: row.createdAt.toISOString(),
        })),
      };
    } catch (error) {
      log.error(error, "failed to list UTXOs");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to list UTXOs" };
    }
  };
}
