/**
 * Course materials from AWS S3.
 * Bucket + read-only IAM keys: course-materials.config.json (committed to GitHub).
 * Groq key: api/.env (committed to GitHub).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  OerIndex,
  extractTextFromBuffer,
  isIndexableExtension,
} from "./oer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
export const CONFIG_PATH = path.join(REPO_ROOT, "course-materials.config.json");
export const LOCAL_CACHE = path.join(REPO_ROOT, "course-materials");

const BLOCKED_KEY =
  /(^|\/)(worksheet_keys|projects_keys|worksheet_answer_keys|.*_keys|solutions?|answers?)(\/|$)/i;

export function loadS3Config() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    if (!raw?.enabled) return null;

    const bucket = String(raw.bucket || "").trim();
    const region = String(raw.region || "").trim();
    const prefix = String(raw.prefix || "course-materials/").replace(/^\/+/, "");

    const accessKeyId =
      String(raw.accessKeyId || "").trim() ||
      process.env.AWS_ACCESS_KEY_ID?.trim() ||
      process.env.S3_ACCESS_KEY_ID?.trim();
    const secretAccessKey =
      String(raw.secretAccessKey || "").trim() ||
      process.env.AWS_SECRET_ACCESS_KEY?.trim() ||
      process.env.S3_SECRET_ACCESS_KEY?.trim();

    if (!bucket || !region) {
      console.warn("[oer-s3] course-materials.config.json missing bucket or region.");
      return null;
    }
    if (!accessKeyId || !secretAccessKey) {
      console.warn(
        "[oer-s3] missing read-only AWS keys — set accessKeyId/secretAccessKey in course-materials.config.json."
      );
      return null;
    }

    return { bucket, region, prefix, accessKeyId, secretAccessKey };
  } catch (e) {
    console.warn(`[oer-s3] could not read config: ${String(e?.message || e)}`);
    return null;
  }
}

function ensurePrefix(p) {
  return p.endsWith("/") ? p : `${p}/`;
}

function makeS3Client(config) {
  return new S3Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

async function streamToBuffer(body) {
  const chunks = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function listS3ObjectKeys(client, bucket, prefix) {
  const keys = [];
  let token;
  do {
    const list = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      })
    );
    for (const obj of list.Contents || []) {
      if (obj.Key) keys.push(obj.Key);
    }
    token = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

function shouldSkipKey(key, prefix) {
  const rel = key.startsWith(prefix) ? key.slice(prefix.length) : key;
  if (!rel || rel.endsWith("/")) return true;
  return BLOCKED_KEY.test(rel) || /(answer[_-]?key|solution|_keys?)\b/i.test(rel);
}

function localCacheReady() {
  if (!fs.existsSync(LOCAL_CACHE)) return false;
  try {
    const entries = fs.readdirSync(LOCAL_CACHE, { withFileTypes: true });
    return entries.some((e) => e.isFile() || e.isDirectory());
  } catch {
    return false;
  }
}

async function streamToFile(body, destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const chunks = [];
  for await (const chunk of body) chunks.push(chunk);
  fs.writeFileSync(destPath, Buffer.concat(chunks));
}

/**
 * List and read S3 objects, build the in-memory OER index for the tutor.
 */
export async function buildOerIndexFromS3(config = loadS3Config()) {
  if (!config) {
    throw new Error("S3 config missing or disabled (course-materials.config.json).");
  }

  const prefix = ensurePrefix(config.prefix);
  const client = makeS3Client(config);
  const keys = await listS3ObjectKeys(client, config.bucket, prefix);
  const entries = [];

  for (const key of keys) {
    if (shouldSkipKey(key, prefix)) continue;
    const rel = key.slice(prefix.length).replace(/\\/g, "/");
    const ext = path.extname(rel).toLowerCase();
    if (!isIndexableExtension(ext)) continue;

    const got = await client.send(
      new GetObjectCommand({ Bucket: config.bucket, Key: key })
    );
    if (!got.Body) continue;

    const buf = await streamToBuffer(got.Body);
    const text = extractTextFromBuffer(buf, ext, key);
    if (text) entries.push({ relPath: rel, text, ext });
  }

  const root = `s3://${config.bucket}/${prefix}`;
  console.log(`[oer-s3] indexed ${entries.length} files from ${root}`);
  return new OerIndex(root, { includeKeys: false }).buildFromEntries(entries);
}

export async function fetchCourseMaterialsFromS3(config = loadS3Config()) {
  if (!config) {
    throw new Error("S3 config missing or disabled (course-materials.config.json).");
  }

  const prefix = ensurePrefix(config.prefix);
  const client = makeS3Client(config);

  if (fs.existsSync(LOCAL_CACHE)) {
    fs.rmSync(LOCAL_CACHE, { recursive: true, force: true });
  }
  fs.mkdirSync(LOCAL_CACHE, { recursive: true });

  let token;
  let count = 0;
  do {
    const list = await client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: prefix,
        ContinuationToken: token,
      })
    );
    for (const obj of list.Contents || []) {
      if (!obj.Key || shouldSkipKey(obj.Key, prefix)) continue;
      const rel = obj.Key.slice(prefix.length);
      const dest = path.join(LOCAL_CACHE, rel);
      const got = await client.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: obj.Key })
      );
      if (!got.Body) continue;
      await streamToFile(got.Body, dest);
      count++;
    }
    token = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (token);

  console.log(
    `[oer-s3] downloaded ${count} files from s3://${config.bucket}/${prefix} -> ${LOCAL_CACHE}`
  );
  return count;
}

/**
 * Ensure course-materials/ exists locally before the OER index is built.
 * - S3 config enabled: download (or refresh when OER_REFRESH_S3=1).
 * - Otherwise: use existing local folder or monorepo sibling.
 */
export async function ensureLocalCourseMaterials() {
  const config = loadS3Config();
  const refresh = /^(1|true|yes)$/i.test(
    String(process.env.OER_REFRESH_S3 || "").trim()
  );

  if (config) {
    if (!localCacheReady() || refresh) {
      await fetchCourseMaterialsFromS3(config);
    } else {
      console.log(`[oer-s3] using cached ${LOCAL_CACHE} (set OER_REFRESH_S3=1 to re-download)`);
    }
    return LOCAL_CACHE;
  }

  if (localCacheReady()) {
    console.log(`[oer-s3] no S3 config — using local ${LOCAL_CACHE}`);
    return LOCAL_CACHE;
  }

  console.log(
    "[oer-s3] no S3 config and no local cache — will try monorepo sibling csuf-ssp-oer if present."
  );
  return null;
}
