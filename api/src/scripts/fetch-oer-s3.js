/**
 * Download course-materials from S3 using course-materials.config.json.
 * Run: npm run fetch:oer -w api
 */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { fetchCourseMaterialsFromS3 } from "../s3-course-materials.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

try {
  await fetchCourseMaterialsFromS3();
} catch (e) {
  console.error(`[fetch:oer] ${String(e?.message || e)}`);
  process.exit(1);
}

const verify = spawnSync(process.execPath, ["src/scripts/verify-oer-bundle.js"], {
  cwd: path.resolve(__dirname, "../.."),
  stdio: "inherit",
});
process.exit(verify.status ?? 0);
