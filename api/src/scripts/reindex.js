/**
 * Stand-alone check: build the OER index and print what was found.
 * Useful to confirm S3 or local course materials work before starting the server.
 * Run with: npm run index:oer
 */
import "dotenv/config";
import { buildIndex } from "../oer.js";
import { buildOerIndexFromS3, loadS3Config } from "../s3-course-materials.js";

const s3Config = loadS3Config();
const index = s3Config
  ? await buildOerIndexFromS3(s3Config)
  : buildIndex();
const stats = index.stats();

console.log("\n=== csuf-ssp-oer index ===");
console.log(`path:    ${stats.root}`);
console.log(`exists:  ${stats.available}`);
console.log(`files:   ${stats.files}`);
console.log(`chunks:  ${stats.chunks}`);
console.log(`modules: ${stats.modules}`);
console.log(`answer-key files excluded: ${stats.excludedAnswerKeys}`);

console.log("\n=== curriculum map (what the tutor understands) ===");
console.log(index.curriculumOutline());

const demoQuery = process.argv.slice(2).join(" ") || "verilog testbench inverter";
console.log(`\n=== sample retrieval for: "${demoQuery}" ===`);
for (const r of index.retrieve(demoQuery, { topK: 3 })) {
  console.log(`\n[${r.score}] ${r.label}  (${r.source})`);
  console.log(r.text.slice(0, 220).replace(/\s+/g, " ") + "…");
}
