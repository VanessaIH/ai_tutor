/**
 * Read-only connection to the csuf-ssp-oer course materials.
 *
 * This module NEVER writes to the OER repo. It walks the configured content
 * directory, extracts plain text from the course files (Markdown, source code,
 * and Office documents: .docx / .pptx), splits everything into small chunks,
 * and exposes a lightweight lexical retriever so the tutor can ground its
 * answers in the actual program material.
 *
 * No external search service or embedding model is required: retrieval is a
 * self-contained TF/IDF-style overlap score, which keeps the tutor usable
 * fully offline (e.g. paired with a local Ollama model).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import AdmZip from "adm-zip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Bundled materials shipped inside tutor-chat-bot (student distribution). */
const BUNDLED_OER_PATH = path.resolve(__dirname, "../../course-materials");
/** Monorepo fallback when developing next to csuf-ssp-oer. */
const SIBLING_OER_PATH = path.resolve(__dirname, "../../../csuf-ssp-oer");

/** File extensions we can turn into searchable text. */
const TEXT_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".v",
  ".sv",
  ".vh",
  ".py",
  ".csv",
  ".json",
  ".tcl",
  ".c",
  ".h",
]);

const DOCX_EXTENSIONS = new Set([".docx"]);
const PPTX_EXTENSIONS = new Set([".pptx"]);

/** Skip noise that would never help a tutoring answer. */
const SKIP_DIRS = new Set([".git", "node_modules", ".vscode", "__pycache__"]);

const CHUNK_TARGET_CHARS = 1100;
const CHUNK_OVERLAP_CHARS = 150;

/** Words too common to be useful for matching. */
const STOP_WORDS = new Set(
  (
    "a an and are as at be by for from has have how i in is it its of on or " +
    "that the this to was were what when where which who why will with you your " +
    "do does can could should would about into than then them they we our"
  ).split(/\s+/)
);

function xmlToText(xml, tagName) {
  // Pull the text out of every <tag>...</tag> node, then de-entity it.
  const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "g");
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    out.push(m[1]);
  }
  return out
    .join(" ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function readDocx(source) {
  const zip = new AdmZip(source);
  const entry = zip.getEntry("word/document.xml");
  if (!entry) return "";
  const xml = zip.readAsText(entry);
  // Treat each paragraph as a line so chunking respects structure.
  const paragraphs = xml
    .split(/<\/w:p>/)
    .map((p) => xmlToText(p + "</w:p>", "w:t").trim())
    .filter(Boolean);
  return paragraphs.join("\n");
}

function readPptx(source) {
  const zip = new AdmZip(source);
  const slides = zip
    .getEntries()
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => {
      const na = parseInt(a.entryName.replace(/\D/g, ""), 10) || 0;
      const nb = parseInt(b.entryName.replace(/\D/g, ""), 10) || 0;
      return na - nb;
    });

  const parts = [];
  slides.forEach((entry, i) => {
    const xml = zip.readAsText(entry);
    const text = xmlToText(xml, "a:t").replace(/\s+/g, " ").trim();
    if (text) parts.push(`Slide ${i + 1}: ${text}`);
  });
  return parts.join("\n");
}

export function isIndexableExtension(ext) {
  const e = String(ext || "").toLowerCase();
  return TEXT_EXTENSIONS.has(e) || DOCX_EXTENSIONS.has(e) || PPTX_EXTENSIONS.has(e);
}

export function extractTextFromBuffer(buffer, ext, label = "") {
  try {
    if (TEXT_EXTENSIONS.has(ext)) return buffer.toString("utf8");
    if (DOCX_EXTENSIONS.has(ext)) return readDocx(buffer);
    if (PPTX_EXTENSIONS.has(ext)) return readPptx(buffer);
  } catch (err) {
    console.warn(`[oer] could not read ${label || ext}: ${err.message}`);
  }
  return "";
}

function extractText(filePath, ext) {
  return extractTextFromBuffer(fs.readFileSync(filePath), ext, filePath);
}

function walk(dir, acc = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), acc);
    } else if (entry.isFile()) {
      acc.push(path.join(dir, entry.name));
    }
  }
  return acc;
}

/** "hs" / "ug" from filenames like module_01_hs_worksheet_c.docx. */
function audienceOf(relPath) {
  if (/_hs[_-]/i.test(relPath)) return "hs";
  if (/_ug[_-]/i.test(relPath)) return "ug";
  return null;
}

function audienceLabel(code) {
  if (code === "hs") return "High school";
  if (code === "ug") return "Undergraduate";
  return "";
}

/** Worksheet letter from filenames like module_01_hs_worksheet_c.docx. */
function worksheetOf(relPath) {
  const m = relPath.match(/worksheet[_-]([a-d])\b/i);
  return m ? m[1].toLowerCase() : null;
}

/** module_04 -> "Module 04"; otherwise a tidied folder/file label. */
function friendlyLabel(relPath) {
  const moduleMatch = relPath.match(/module[_-]?(\d+)/i);
  const aud = audienceOf(relPath);
  const worksheet = worksheetOf(relPath);
  const kind = relPath.split(/[\\/]/)[0] || "";
  const bits = [];
  if (kind) bits.push(kind.replace(/_/g, " "));
  if (moduleMatch) bits.push(`Module ${moduleMatch[1]}`);
  if (worksheet) bits.push(`Worksheet ${worksheet.toUpperCase()}`);
  if (aud) bits.push(audienceLabel(aud));
  return bits.join(" · ") || relPath;
}

/** Top-level folder e.g. "lectures", "worksheets", "projects_keys". */
function topFolder(relPath) {
  return relPath.split(/[\\/]/)[0] || "";
}

/** "module_04" -> "04". */
function moduleOf(relPath) {
  const m = relPath.match(/module[_-]?(\d+)/i);
  return m ? m[1].padStart(2, "0") : null;
}

/** Folders holding solutions/answer keys — kept out of grounding by default. */
function isAnswerKey(relPath) {
  return /(^|[\\/])(worksheet_keys|projects_keys|.*_keys|solutions?|answers?)([\\/]|$)/i.test(
    relPath
  );
}

/** Pull a few distinctive slide titles from extracted .pptx text for topics. */
const GENERIC_SLIDE_TITLES =
  /^(learning objectives?|objectives?|activity|in class|agenda|overview|introduction|summary|recap|questions?|references?|title|outline|welcome|thank you|q ?& ?a)\b/i;

function slideTitlesFromText(text) {
  const titles = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^Slide \d+:\s*(.+)$/);
    if (!m) continue;
    const title = m[1].trim();
    if (!title || title.length > 70) continue;
    if (GENERIC_SLIDE_TITLES.test(title)) continue;
    titles.push(title);
  }
  return titles;
}

function chunkText(text) {
  const clean = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= CHUNK_TARGET_CHARS) return [clean];

  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + CHUNK_TARGET_CHARS, clean.length);
    if (end < clean.length) {
      // Prefer to break on a newline or sentence boundary.
      const window = clean.slice(start, end);
      const lastBreak = Math.max(
        window.lastIndexOf("\n"),
        window.lastIndexOf(". ")
      );
      if (lastBreak > CHUNK_TARGET_CHARS * 0.5) {
        end = start + lastBreak + 1;
      }
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = end - CHUNK_OVERLAP_CHARS;
    if (start < 0) start = 0;
  }
  return chunks.filter(Boolean);
}

function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9_]+/g) || []).filter(
    (t) => t.length > 1 && !STOP_WORDS.has(t)
  );
}

export class OerIndex {
  constructor(rootPath, { includeKeys = false } = {}) {
    this.root = rootPath;
    this.includeKeys = includeKeys;
    this.chunks = [];
    this.df = new Map(); // document frequency per term
    this.files = [];
    this.docs = []; // per-file metadata for the curriculum map
    this.skippedKeys = 0;
    this.builtAt = null;
  }

  get available() {
    if (this.root.startsWith("s3://")) return true;
    return fs.existsSync(this.root);
  }

  ingestRelPath(relPath, text, ext) {
    if (!this.includeKeys && isAnswerKey(relPath)) {
      this.skippedKeys++;
      return;
    }
    if (!text || !text.trim()) return;

    this.files.push(relPath);
    const label = friendlyLabel(relPath);

    this.docs.push({
      source: relPath,
      kind: topFolder(relPath),
      module: moduleOf(relPath),
      audience: audienceOf(relPath),
      ext,
      topics: PPTX_EXTENSIONS.has(ext) ? slideTitlesFromText(text) : [],
    });

    for (const piece of chunkText(text)) {
      const terms = tokenize(piece);
      if (terms.length === 0) continue;
      const tf = new Map();
      for (const t of terms) tf.set(t, (tf.get(t) || 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) || 0) + 1);
      this.chunks.push({
        source: relPath,
        label,
        module: moduleOf(relPath),
        audience: audienceOf(relPath),
        worksheet: worksheetOf(relPath),
        text: piece,
        tf,
        length: terms.length,
      });
    }
  }

  buildFromEntries(entries) {
    this.chunks = [];
    this.df = new Map();
    this.files = [];
    this.docs = [];
    this.skippedKeys = 0;

    for (const { relPath, text, ext } of entries) {
      this.ingestRelPath(relPath, text, ext);
    }

    this.builtAt = new Date();
    console.log(
      `[oer] indexed ${this.chunks.length} chunks from ${this.files.length} files in ${this.root}` +
        (this.skippedKeys
          ? ` (excluded ${this.skippedKeys} answer-key file${this.skippedKeys === 1 ? "" : "s"})`
          : "")
    );
    return this;
  }

  build() {
    this.chunks = [];
    this.df = new Map();
    this.files = [];
    this.docs = [];
    this.skippedKeys = 0;

    if (!this.available) {
      console.warn(
        `[oer] content path not found: ${this.root} — tutor will run WITHOUT course grounding. Set OER_CONTENT_PATH.`
      );
      this.builtAt = new Date();
      return this;
    }

    const allFiles = walk(this.root);
    for (const filePath of allFiles) {
      const ext = path.extname(filePath).toLowerCase();
      if (
        !TEXT_EXTENSIONS.has(ext) &&
        !DOCX_EXTENSIONS.has(ext) &&
        !PPTX_EXTENSIONS.has(ext)
      ) {
        continue;
      }

      const relPath = path.relative(this.root, filePath);

      // Answer keys hold solutions; never feed them to the tutor (it would
      // defeat the "guide, don't solve" design). We still note they exist.
      if (!this.includeKeys && isAnswerKey(relPath)) {
        this.skippedKeys++;
        continue;
      }

      const text = extractText(filePath, ext);
      this.ingestRelPath(relPath, text, ext);
    }

    this.builtAt = new Date();
    console.log(
      `[oer] indexed ${this.chunks.length} chunks from ${this.files.length} files in ${this.root}` +
        (this.skippedKeys
          ? ` (excluded ${this.skippedKeys} answer-key file${this.skippedKeys === 1 ? "" : "s"})`
          : "")
    );
    return this;
  }

  /**
   * Aggregate per-module structure so the tutor understands the whole program,
   * not just the passages retrieved for one question.
   */
  structure() {
    const modules = new Map();
    const ensure = (key) => {
      if (!modules.has(key)) {
        modules.set(key, {
          module: key,
          lectures: 0,
          worksheets: 0,
          projects: 0,
          examples: 0,
          audiences: new Set(),
          topics: new Set(),
        });
      }
      return modules.get(key);
    };

    for (const d of this.docs) {
      const key = d.module || "misc";
      const m = ensure(key);
      if (d.kind === "lectures") m.lectures++;
      else if (d.kind === "worksheets") m.worksheets++;
      else if (d.kind === "projects") m.projects++;
      else if (d.kind === "examples") m.examples++;
      if (d.audience) m.audiences.add(d.audience);
      for (const t of d.topics) m.topics.add(t);
    }

    return [...modules.values()]
      .sort((a, b) => a.module.localeCompare(b.module))
      .map((m) => ({
        module: m.module,
        lectures: m.lectures,
        worksheets: m.worksheets,
        projects: m.projects,
        examples: m.examples,
        audiences: [...m.audiences],
        topics: [...m.topics].slice(0, 8),
      }));
  }

  /** Compact, prompt-friendly map of the curriculum drawn from csuf-ssp-oer. */
  curriculumOutline() {
    if (!this.docs.length) {
      return "(No csuf-ssp-oer materials are connected.)";
    }
    const lines = [
      "CSUF SSP curriculum map (derived live from the csuf-ssp-oer materials):",
    ];
    for (const m of this.structure()) {
      if (m.module === "misc") continue;
      const mats = [];
      if (m.lectures) mats.push(`${m.lectures} lecture deck${m.lectures === 1 ? "" : "s"}`);
      if (m.worksheets) mats.push(`${m.worksheets} worksheet${m.worksheets === 1 ? "" : "s"}`);
      if (m.projects) mats.push(`${m.projects} project${m.projects === 1 ? "" : "s"}`);
      if (m.examples) mats.push(`${m.examples} code example${m.examples === 1 ? "" : "s"}`);
      const aud = m.audiences.length
        ? ` [${m.audiences.map(audienceLabel).join(", ")}]`
        : "";
      const topics = m.topics.length ? ` — topics: ${m.topics.join("; ")}` : "";
      lines.push(`- Module ${m.module}: ${mats.join(", ") || "materials"}${aud}${topics}`);
    }
    lines.push(
      "Material types: lecture slides (.pptx), worksheets and projects (.docx), and Verilog/Python code examples. Answer keys exist but are intentionally NOT available to you."
    );
    return lines.join("\n");
  }

  idf(term) {
    const n = this.chunks.length || 1;
    const df = this.df.get(term) || 0;
    return Math.log((n + 1) / (df + 1)) + 1;
  }

  /**
   * Return the top-scoring chunks for a query, with relevance scores.
   * Pass `moduleHint` (e.g. "03") to bias results toward a specific module —
   * useful when the student has selected "Lab 3" / Module 3. Pass `partHint`
   * (e.g. "c") to further favour a specific worksheet within that module, so a
   * reference like "module 1C" surfaces module_01 worksheet C.
   */
  retrieve(query, {
    topK = 4,
    moduleHint = null,
    partHint = null,
    audienceHint = null,
    excludeTrackWorksheets = false,
  } = {}) {
    const qTerms = tokenize(query);
    // A module hint alone (with no usable query terms) is still valid.
    if ((qTerms.length === 0 && !moduleHint) || this.chunks.length === 0) return [];
    const partRe = partHint
      ? new RegExp(`worksheet[_-]${partHint}\\b`, "i")
      : null;

    const qWeights = new Map();
    for (const t of qTerms) {
      qWeights.set(t, (qWeights.get(t) || 0) + this.idf(t));
    }

    const pool = this.chunks.filter((chunk) => {
      // Without a track, skip hs/ug worksheets so the tutor asks first.
      if (excludeTrackWorksheets && chunk.audience) return false;
      // When a track is chosen, never mix hs and ug worksheets.
      if (audienceHint && chunk.audience && chunk.audience !== audienceHint) {
        return false;
      }
      return true;
    });

    const scored = pool.map((chunk) => {
      let score = 0;
      for (const [term, w] of qWeights) {
        const tf = chunk.tf.get(term);
        if (tf) score += w * (1 + Math.log(tf));
      }
      // Normalise by chunk length so long files don't dominate.
      score = score / Math.sqrt(chunk.length || 1);
      // Boost (and floor) chunks from the selected module so they surface even
      // when the student's wording doesn't lexically overlap the material.
      if (moduleHint && chunk.module === moduleHint) {
        score = score * 2.5 + 0.05;
      }
      // Within the module, favour the specific worksheet the student named.
      if (partRe && partRe.test(chunk.source)) {
        score = score * 1.8 + 0.03;
      }
      if (audienceHint && chunk.audience === audienceHint) {
        score = score * 1.4 + 0.02;
      }
      return { chunk, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((s) => ({
        source: s.chunk.source,
        label: s.chunk.label,
        text: s.chunk.text,
        score: Number(s.score.toFixed(4)),
      }));
  }

  stats() {
    const structure = this.structure();
    return {
      root: this.root,
      available: this.available,
      files: this.files.length,
      chunks: this.chunks.length,
      modules: structure.filter((m) => m.module !== "misc").length,
      excludedAnswerKeys: this.skippedKeys,
      builtAt: this.builtAt,
    };
  }
}

export function resolveOerPath() {
  const fromEnv = process.env.OER_CONTENT_PATH?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  if (fs.existsSync(BUNDLED_OER_PATH)) return BUNDLED_OER_PATH;
  return SIBLING_OER_PATH;
}

export function buildIndex() {
  const root = resolveOerPath();
  // Student bundle must never load answer keys, even if env is mis-set.
  const includeKeys =
    root !== BUNDLED_OER_PATH &&
    /^(1|true|yes)$/i.test(String(process.env.OER_INCLUDE_KEYS || "").trim());
  const index = new OerIndex(root, { includeKeys });
  return index.build();
}
