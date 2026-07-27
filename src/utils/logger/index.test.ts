import { assertStringIncludes } from "@std/assert";
import { Level, newLogger, type Writer } from "./index.ts";

function captureWriter(): { lines: string[]; writer: Writer } {
  const lines: string[] = [];
  return { lines, writer: { write: (line) => lines.push(line) } };
}

Deno.test("error() renders a non-Error plain-object throw as its content, not [object Object]", () => {
  const { lines, writer } = captureWriter();
  const log = newLogger(Level.Info, { writer });

  // The Stellar RPC throws plain objects, not Error instances. Before the fix
  // flattenCauses fell through to String(obj) → "[object Object]".
  log.error(
    { code: -32600, message: "startLedger out of range" },
    "poll error",
  );

  const line = lines.join("\n");
  assertStringIncludes(line, "startLedger out of range");
  assertStringIncludes(line, "-32600");
  if (line.includes("[object Object]")) {
    throw new Error(`error line masked the object: ${line}`);
  }
});

Deno.test("error() still flattens a real Error's cause chain", () => {
  const { lines, writer } = captureWriter();
  const log = newLogger(Level.Info, { writer });

  const inner = new Error("rpc refused");
  const outer = new Error("fetch failed", { cause: inner });
  log.error(outer, "poll error");

  const line = lines.join("\n");
  assertStringIncludes(line, "fetch failed");
  assertStringIncludes(line, "rpc refused");
});
