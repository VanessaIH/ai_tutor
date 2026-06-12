/**
 * Fail if course-materials/ contains answer-key folders or files.
 * Run after sync:oer and before shipping to students.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE = path.resolve(__dirname, "../../../course-materials");

const BLOCKED_PATH =
  /(^|[\\/])(worksheet_keys|projects_keys|worksheet_answer_keys|.*_keys|solutions?|answers?)([\\/]|$)/i;
const BLOCKED_FILE = /(answer[_-]?key|solution|_keys?)\b/i;

function walk(dir, rel = "", violations = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (BLOCKED_PATH.test(relPath)) {
      violations.push(relPath);
      continue;
    }
    if (entry.isDirectory()) {
      walk(full, relPath, violations);
      continue;
    }
    if (entry.isFile() && BLOCKED_FILE.test(entry.name)) {
      violations.push(relPath);
    }
  }
  return violations;
}

if (!fs.existsSync(BUNDLE)) {
  console.error(`[verify:oer] missing bundle: ${BUNDLE}`);
  console.error("Run: npm run sync:oer");
  process.exit(1);
}

const bad = walk(BUNDLE);
if (bad.length) {
  console.error("[verify:oer] answer-key content found in student bundle:");
  for (const p of bad) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`[verify:oer] OK — no answer keys in ${BUNDLE}`);
