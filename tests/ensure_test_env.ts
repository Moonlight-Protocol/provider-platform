/** Side-effect import: defaults before any `@/config/env.ts` load (e.g. dashboard handlers). */
if (Deno.env.get("BUNDLE_MAX_OPERATIONS") === undefined) {
  Deno.env.set("BUNDLE_MAX_OPERATIONS", "20");
}
