// One-off: embed the Atlas Inbox decisions under the LOCAL provider so
// decision_check can promote auto-send proposals to a hard `conflict`.
// Run: BRAIN_DIR=".../.brain" BRAIN_EMBEDDINGS=local node scripts/backfill-atlas-embeddings.mjs
import { readFile } from "fs/promises";
import { join } from "path";
import { embedDecision } from "../dist/utils/embeddings.js";

const brainDir = process.env.BRAIN_DIR;
if (!brainDir) throw new Error("Set BRAIN_DIR");
const decisions = JSON.parse(await readFile(join(brainDir, "decisions", "decisions.json"), "utf-8"));
const atlas = decisions.filter((d) => d.entity_id === "atlas-inbox" && d.status === "active");

console.error(`Provider: ${process.env.BRAIN_EMBEDDINGS} | embedding ${atlas.length} atlas decisions...`);
for (const d of atlas) {
  await embedDecision(d.id, d);
  console.error(`  embedded ${d.id} (chosen${d.alternatives?.length ? " + rejected" : ""}) — ${d.decision.slice(0, 60)}`);
}
console.error("Done.");
