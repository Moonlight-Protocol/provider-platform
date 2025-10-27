import { collection, kvdex, model } from "@olli/kvdex";
import { challengeCollection } from "../models/auth/challenges/challenge.model.ts";
import { userCollection } from "../models/user/user.model.ts";
import { bundleCollection } from "../models/bundle/bundle.model.ts";
import { utxoCollection } from "../models/utxo/utxo.model.ts";

const kv = await Deno.openKv("./.data/kvdb.db");
const db = kvdex({
  kv: kv,
  schema: {
    challenges: challengeCollection,
    users: userCollection,
    bundles: bundleCollection,
    utxos: utxoCollection,
  },
});

export { kv, db };
