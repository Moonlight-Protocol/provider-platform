import { RawBundle } from "../../models/bundle/bundle.schema.ts";
import { calculateChange } from "./calculate-change.ts";

export async function calculateChanges(bundles: RawBundle[]): Promise<bigint> {
  let change: bigint = 0n;
  for (const b of bundles) {
    change += await calculateChange(b);
  }

  return change;
}
