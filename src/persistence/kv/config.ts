import { kvdex } from "@olli/kvdex";
import { sessionCollection } from "./entity/session.entity.ts";

//  Memory Database
// Ensure .data directory exists before opening KV
await Deno.mkdir(".data", { recursive: true });
const memoryKv = await Deno.openKv("./.data/memory-kvdb.db");

const memDb = kvdex({
  kv: memoryKv,
  schema: {
    sessions: sessionCollection,
  },
});

export { memoryKv, memDb };
