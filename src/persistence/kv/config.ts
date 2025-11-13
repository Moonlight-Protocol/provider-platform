import { kvdex } from "@olli/kvdex";
import { sessionCollection } from "./entity/session.entity.ts";

//  Memory Database
const memoryKv = await Deno.openKv("./.data/memory-kvdb.db");

const memDb = kvdex({
  kv: memoryKv,
  schema: {
    sessions: sessionCollection,
  },
});

export { memoryKv, memDb };
