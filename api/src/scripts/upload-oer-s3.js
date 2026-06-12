/**
 * Maintainer: push csuf-ssp-oer → S3 (worksheets, projects, lectures, examples).
 * Credentials: csuf-ssp-oer/aws-updater (or AWS_UPLOAD_* env vars).
 * Bucket/region: aws-updater file, or course-materials.config.json as fallback.
 *
 * Run from tutor-chat-bot:
 *   npm run upload:oer -w api
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  defaultOerRoot,
  uploadCredentialsFromAwsUpdater,
} from "../aws-updater.js";
import { loadS3Config, LOCAL_CACHE } from "../s3-course-materials.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BLOCKED_PATH =
  /(^|[\\/])(worksheet_keys|projects_keys|worksheet_answer_keys|.*_keys|solutions?|answers?)([\\/]|$)/i;

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
    name === "aws-updater" ||
    /^answer/i.test(name) ||
    /^solution/i.test(name)
  );
}

function shouldSkipFile(name) {
  return (
    name === "aws-updater" ||
    /(answer[_-]?key|solution|_keys?)\b/i.test(name)
  );
}

function walk(dir, rel = "", out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (BLOCKED_PATH.test(relPath)) continue;
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue;
      walk(full, relPath, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (shouldSkipFile(entry.name)) continue;
    out.push({ full, rel: relPath.replace(/\\/g, "/") });
  }
  return out;
}

function resolveUploadTarget() {
  const fromUpdater = uploadCredentialsFromAwsUpdater();
  const fromEnv = {
    accessKeyId: process.env.AWS_UPLOAD_ACCESS_KEY_ID?.trim(),
    secretAccessKey: process.env.AWS_UPLOAD_SECRET_ACCESS_KEY?.trim(),
  };
  const s3config = loadS3Config();

  const accessKeyId = fromEnv.accessKeyId || fromUpdater?.accessKeyId;
  const secretAccessKey = fromEnv.secretAccessKey || fromUpdater?.secretAccessKey;
  const region =
    fromUpdater?.region || s3config?.region || process.env.AWS_REGION?.trim() || "us-west-2";
  const bucket =
    fromUpdater?.bucket || s3config?.bucket || process.env.AWS_BUCKET?.trim() || "";
  const prefix =
    fromUpdater?.prefix || s3config?.prefix || process.env.AWS_PREFIX?.trim() || "course-materials/";

  if (!accessKeyId || !secretAccessKey) {
    console.error(
      "[upload:oer] no upload credentials. Add csuf-ssp-oer/aws-updater or set AWS_UPLOAD_ACCESS_KEY_ID / AWS_UPLOAD_SECRET_ACCESS_KEY."
    );
    process.exit(1);
  }
  if (!bucket || bucket === "your-bucket-name") {
    console.error("[upload:oer] set AWS_BUCKET in csuf-ssp-oer/aws-updater (or course-materials.config.json).");
    process.exit(1);
  }

  return {
    accessKeyId,
    secretAccessKey,
    region,
    bucket,
    prefix: prefix.endsWith("/") ? prefix : `${prefix}/`,
  };
}

const useCache = /^(1|true|yes)$/i.test(
  String(process.env.OER_UPLOAD_FROM_CACHE || "").trim()
);
const oerRoot = defaultOerRoot();
const uploadRoot = useCache ? LOCAL_CACHE : oerRoot;

if (!fs.existsSync(uploadRoot)) {
  console.error(
    useCache
      ? `[upload:oer] run npm run sync:oer first — ${LOCAL_CACHE} not found.`
      : `[upload:oer] csuf-ssp-oer not found: ${oerRoot}`
  );
  process.exit(1);
}

const target = resolveUploadTarget();
const client = new S3Client({
  region: target.region,
  credentials: {
    accessKeyId: target.accessKeyId,
    secretAccessKey: target.secretAccessKey,
  },
});

const files = walk(uploadRoot);
let n = 0;
for (const f of files) {
  const key = `${target.prefix}${f.rel}`;
  const body = fs.readFileSync(f.full);
  await client.send(
    new PutObjectCommand({
      Bucket: target.bucket,
      Key: key,
      Body: body,
    })
  );
  n++;
}

console.log(
  `[upload:oer] uploaded ${n} files from ${uploadRoot} to s3://${target.bucket}/${target.prefix}`
);
