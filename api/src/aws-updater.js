/**
 * Load maintainer upload credentials from csuf-ssp-oer/aws-updater.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OER_ROOT = path.resolve(__dirname, "../../../csuf-ssp-oer");

export function defaultOerRoot() {
  return process.env.OER_SYNC_SOURCE?.trim()
    ? path.resolve(process.env.OER_SYNC_SOURCE.trim())
    : DEFAULT_OER_ROOT;
}

export function awsUpdaterPath(oerRoot = defaultOerRoot()) {
  return path.join(oerRoot, "aws-updater");
}

/** Parse KEY=VALUE lines from aws-updater (comments and blanks ignored). */
export function loadAwsUpdater(oerRoot = defaultOerRoot()) {
  const filePath = awsUpdaterPath(oerRoot);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const out = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    out[key] = value;
  }
  return out;
}

export function uploadCredentialsFromAwsUpdater(oerRoot = defaultOerRoot()) {
  const raw = loadAwsUpdater(oerRoot);
  if (!raw) return null;
  const accessKeyId = raw.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = raw.AWS_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) return null;
  return {
    accessKeyId,
    secretAccessKey,
    region: raw.AWS_REGION?.trim() || "us-west-2",
    bucket: raw.AWS_BUCKET?.trim() || "",
    prefix: raw.AWS_PREFIX?.trim() || "course-materials/",
  };
}
