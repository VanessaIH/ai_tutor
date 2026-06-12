/**
 * Copy course materials into tutor-chat-bot/course-materials for distribution.
 * Students only need the tutor repo; maintainers re-run this when csuf-ssp-oer updates.
 *
 * Usage:
 *   npm run sync:oer -w api
 *   OER_SYNC_SOURCE=/path/to/csuf-ssp-oer npm run sync:oer -w api
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEST = path.resolve(__dirname, "../../../course-materials");
const DEFAULT_SOURCE = path.resolve(__dirname, "../../../../csuf-ssp-oer");
const SOURCE = process.env.OER_SYNC_SOURCE?.trim()
  ? path.resolve(process.env.OER_SYNC_SOURCE.trim())
  : DEFAULT_SOURCE;

const SKIP_DIRS = new Set([
  "worksheet_keys",
  "projects_keys",
  "worksheet_answer_keys",
  "solutions",
  "answers",
  ".git",
  "node_modules",
]);

function shouldSkipDir(name) {
  return (
    SKIP_DIRS.has(name) ||
    /_keys$/i.test(name) ||
    /^answer/i.test(name) ||
    /^solution/i.test(name)
  );
}

function shouldSkipFile(name) {
  return /(answer[_-]?key|solution|_keys?)\b/i.test(name);
}

function copyTree(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue;
      copyTree(path.join(srcDir, entry.name), path.join(destDir, entry.name));
      continue;
    }
    if (!entry.isFile()) continue;
    if (shouldSkipFile(entry.name)) continue;
    const from = path.join(srcDir, entry.name);
    const to = path.join(destDir, entry.name);
    fs.copyFileSync(from, to);
  }
}

function countFiles(dir) {
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) n += countFiles(full);
    else if (entry.isFile()) n++;
  }
  return n;
}

if (!fs.existsSync(SOURCE)) {
  console.error(`[sync:oer] source not found: ${SOURCE}`);
  console.error("Set OER_SYNC_SOURCE to your csuf-ssp-oer folder.");
  process.exit(1);
}

if (fs.existsSync(DEST)) {
  fs.rmSync(DEST, { recursive: true, force: true });
}

copyTree(SOURCE, DEST);
const files = countFiles(DEST);
console.log(`[sync:oer] copied ${files} files from ${SOURCE}`);
console.log(`[sync:oer] -> ${DEST}`);
console.log("[sync:oer] answer-key folders and files were skipped.");

const verify = spawnSync(process.execPath, ["src/scripts/verify-oer-bundle.js"], {
  cwd: path.resolve(__dirname, "../.."),
  stdio: "inherit",
});
if (verify.status !== 0) process.exit(verify.status ?? 1);
