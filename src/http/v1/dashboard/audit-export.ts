import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { OperationsBundleRepository } from "@/persistence/drizzle/repository/index.ts";
import { BundleStatus } from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import { LOG } from "@/config/logger.ts";

const bundleRepo = new OperationsBundleRepository(drizzleClient);

function csvEscape(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

/**
 * GET /dashboard/audit-export?status=COMPLETED&from=2026-01-01&to=2026-03-16
 *
 * Returns bundle data as CSV for compliance reporting.
 * Date filtering is done in SQL, not in-memory.
 */
export const getAuditExportHandler = async (ctx: Context) => {
  const params = ctx.request.url.searchParams;
  const statusParam = params.get("status") || "COMPLETED";

  if (!(statusParam in BundleStatus)) {
    ctx.response.status = Status.BadRequest;
    ctx.response.body = {
      message: `Invalid status. Must be one of: ${
        Object.keys(BundleStatus).join(", ")
      }`,
    };
    return;
  }

  const status = statusParam as BundleStatus;
  const fromRaw = params.get("from");
  const toRaw = params.get("to");
  const from = fromRaw ? new Date(fromRaw) : undefined;
  const to = toRaw ? new Date(toRaw) : undefined;

  if ((from && isNaN(from.getTime())) || (to && isNaN(to.getTime()))) {
    ctx.response.status = Status.BadRequest;
    ctx.response.body = {
      message: "Invalid date format. Use ISO 8601 (e.g., 2026-01-01).",
    };
    return;
  }

  try {
    const bundles = await bundleRepo.findByStatusAndDateRange(status, from, to);

    const headers = ["id", "status", "fee", "createdAt", "updatedAt"];
    const rows = bundles.map((b) =>
      [
        csvEscape(b.id),
        csvEscape(b.status),
        csvEscape(b.fee?.toString() ?? ""),
        csvEscape(b.createdAt.toISOString()),
        csvEscape(b.updatedAt?.toISOString() ?? ""),
      ].join(",")
    );
    const csv = [headers.join(","), ...rows].join("\n");

    ctx.response.status = Status.OK;
    ctx.response.headers.set("Content-Type", "text/csv");
    ctx.response.headers.set(
      "Content-Disposition",
      `attachment; filename="audit-export-${status}-${
        new Date().toISOString().slice(0, 10)
      }.csv"`,
    );
    ctx.response.body = csv;
  } catch (error) {
    LOG.error("Audit export failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    ctx.response.status = Status.InternalServerError;
    ctx.response.body = {
      message: "Failed to generate audit export",
    };
  }
};
