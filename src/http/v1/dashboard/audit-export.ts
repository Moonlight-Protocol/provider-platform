import { type Context, Status } from "@oak/oak";
import { and, between, eq, gte, isNull, lte } from "drizzle-orm";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import {
  BundleStatus,
  operationsBundle,
} from "@/persistence/drizzle/entity/operations-bundle.entity.ts";
import type { PaymentProvider } from "@/persistence/drizzle/entity/pp.entity.ts";
import type { Logger } from "@/utils/logger/index.ts";

function csvEscape(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

/**
 * GET /api/v1/providers/:ppPublicKey/audit-export?status=COMPLETED&from=2026-01-01&to=2026-03-16
 *
 * Returns bundle data as CSV for compliance reporting, scoped to this PP.
 */
export function handleGetAuditExport(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("getAuditExport");

  return async (ctx) => {
    log.info("getAuditExport");
    const pp = ctx.state.pp as PaymentProvider;
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
      const dateClauses = [];
      if (from && to) {
        dateClauses.push(between(operationsBundle.createdAt, from, to));
      } else if (from) {
        dateClauses.push(gte(operationsBundle.createdAt, from));
      } else if (to) {
        dateClauses.push(lte(operationsBundle.createdAt, to));
      }
      const bundles = await drizzleClient
        .select({
          id: operationsBundle.id,
          status: operationsBundle.status,
          fee: operationsBundle.fee,
          createdAt: operationsBundle.createdAt,
          updatedAt: operationsBundle.updatedAt,
        })
        .from(operationsBundle)
        .where(
          and(
            eq(operationsBundle.ppPublicKey, pp.publicKey),
            eq(operationsBundle.status, status),
            isNull(operationsBundle.deletedAt),
            ...dateClauses,
          ),
        );

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
      log.error(error, "audit export failed");

      ctx.response.status = Status.InternalServerError;
      ctx.response.body = {
        message: "Failed to generate audit export",
      };
    }
  };
}
