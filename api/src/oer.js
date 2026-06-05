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

/** Default assumes csuf-ssp-oer is a sibling of this repo (read-only). */
const DEFAULT_OER_PATH = path.resolve(__dirname, "../../../csuf-ssp-oer");

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

function readDocx(filePath) {
  const zip = new AdmZip(filePath);
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

function readPptx(filePath) {
  const zip = new AdmZip(filePath);
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

function extractText(filePath, ext) {
  try {
    if (TEXT_EXTENSIONS.has(ext)) {
      return fs.readFileSync(filePath, "utf8");
    }
    if (DOCX_EXTENSIONS.has(ext)) return readDocx(filePath);
    if (PPTX_EXTENSIONS.has(ext)) return readPptx(filePath);
  } catch (err) {
    console.warn(`[oer] could not read ${filePath}: ${err.message}`);
  }
  return "";
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

/** module_04 -> "Module 04"; otherwise a tidied folder/file label. */
function friendlyLabel(relPath) {
  const moduleMatch = relPath.match(/module[_-]?(\d+)/i);
  const audience = /\b(hs|highschool|high_school)\b/i.test(relPath)
    ? "High school"
    : /\bug\b/i.test(relPath)
      ? "Undergraduate"
      : "";
  const kind = relPath.split(/[\\/]/)[0] || "";
  const bits = [];
  if (kind) bits.push(kind.replace(/_/g, " "));
  if (moduleMatch) bits.push(`Module ${moduleMatch[1]}`);
  if (audience) bits.push(audience);
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

/** "ug" -> Undergraduate, "hs" -> High school. */
function audienceOf(relPath) {
  if (/\b(hs|highschool|high_school)\b/i.test(relPath)) return "High school";
  if (/\bug\b/i.test(relPath)) return "Undergraduate";
  return null;
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
    return fs.existsSync(this.root);
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
      if (!text || !text.trim()) continue;

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
          text: piece,
          tf,
          length: terms.length,
        });
      }
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
      const aud = m.audiences.length ? ` [${m.audiences.join(", ")}]` : "";
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
  retrieve(query, { topK = 4, moduleHint = null, partHint = null } = {}) {
    const qTerms = tokenize(query);
    // A module hint alone (with no usable query terms) is still valid.
    if ((qTerms.length === 0 && !moduleHint) || this.chunks.length === 0) return [];
    const partRe = partHint
      ? new RegExp(`worksheet_${partHint}\\b`, "i")
      : null;

    const qWeights = new Map();
    for (const t of qTerms) {
      qWeights.set(t, (qWeights.get(t) || 0) + this.idf(t));
    }

    const scored = this.chunks.map((chunk) => {
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
  return fromEnv ? path.resolve(fromEnv) : DEFAULT_OER_PATH;
}

export function buildIndex() {
  const includeKeys = /^(1|true|yes)$/i.test(
    String(process.env.OER_INCLUDE_KEYS || "").trim()
  );
  const index = new OerIndex(resolveOerPath(), { includeKeys });
  return index.build();
}
