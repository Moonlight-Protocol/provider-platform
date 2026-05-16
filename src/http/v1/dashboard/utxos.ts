import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PpRepository } from "@/persistence/drizzle/repository/pp.repository.ts";
import { UtxoRepository } from "@/persistence/drizzle/repository/utxo.repository.ts";
import { LOG } from "@/config/logger.ts";

const ppRepo = new PpRepository(drizzleClient);
const utxoRepo = new UtxoRepository(drizzleClient);

/**
 * GET /dashboard/utxos?ppPublicKey=G...&channelContractId=C...
 *
 * Returns the currently-unspent UTXOs the provider has created in the given
 * privacy channel — i.e. outputs the provider's previous bundles minted that
 * have not yet been spent or withdrawn. The dashboard surfaces them as the
 * "ready to be withdrawn" pool.
 */
export const getUtxosHandler = async (ctx: Context) => {
  try {
    const ppPublicKey = ctx.request.url.searchParams.get("ppPublicKey");
    const channelContractId = ctx.request.url.searchParams.get(
      "channelContractId",
    );

    if (!ppPublicKey) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = {
        message: "ppPublicKey query parameter is required",
      };
      return;
    }
    if (!channelContractId) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = {
        message: "channelContractId query parameter is required",
      };
      return;
    }

    const ownerPublicKey = (ctx.state.session as { sub: string }).sub;
    const pp = await ppRepo.findByPublicKeyAndOwner(
      ppPublicKey,
      ownerPublicKey,
    );
    if (!pp) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Provider not found" };
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
    LOG.error("Failed to list UTXOs", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to list UTXOs" };
  }
};
