import { isDefined } from "@/utils/type-guards/is-defined.ts";

export function isError(e: unknown): e is Error {
  return isDefined(e) && typeof e === "object" && e instanceof Error;
}
