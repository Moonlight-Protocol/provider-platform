import { kvdex } from "@olli/kvdex";
import { sessionCollection } from "../models/auth/session/session.model.ts";

// const memoryKv = await Deno.openKv(":memory:");
const memoryKv = await Deno.openKv();

const memDb = kvdex({
  kv: memoryKv,
  schema: {
    sessions: sessionCollection,
  },
});

export { memoryKv, memDb };
