import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import { buildIndex } from "./oer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 3001;

const hasApiKey = Boolean(process.env.OPENAI_API_KEY?.trim());
const explicitBase = process.env.OPENAI_BASE_URL?.trim();

/**
 * OpenAI-compatible chat completions base (no trailing /chat/completions).
 * Default: local Ollama when no key is set; official OpenAI when a key is set and URL omitted.
 */
const OPENAI_BASE_URL = (
  explicitBase
    ? explicitBase
    : hasApiKey
      ? "https://api.openai.com/v1"
      : "http://127.0.0.1:11434/v1"
).replace(/\/$/, "");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
/** Official OpenAI API (model slugs like gpt-4o-mini). */
const isOfficialOpenAI = /:\/\/[^/]*api\.openai\.com\b/i.test(OPENAI_BASE_URL);
/** Azure OpenAI — use deployment name in OPENAI_MODEL. */
const isAzureOpenAI = /openai\.azure\.com/i.test(OPENAI_BASE_URL);
const needsOpenAIKey = isOfficialOpenAI || isAzureOpenAI;
/** Local Ollama runtime (vs. a hosted OpenAI-compatible provider). */
const likelyOllama = /127\.0\.0\.1:11434|localhost:11434|:11434\b/.test(
  OPENAI_BASE_URL
);

/**
 * Speed presets for OpenAI chat (override any time with OPENAI_MODEL).
 * - fast: smallest / lowest-latency models (good for tutoring Q&A)
 * - balanced: reliable default on all API keys
 * - quality: stronger reasoning, slower
 */
const MODEL_PRESETS = {
  fast: process.env.OPENAI_MODEL_FAST || "gpt-5-nano",
  balanced: process.env.OPENAI_MODEL_BALANCED || "gpt-4o-mini",
  quality: process.env.OPENAI_MODEL_QUALITY || "gpt-4o",
};

const presetRaw = (process.env.OPENAI_MODEL_PRESET || "fast").toLowerCase();
const presetModel = MODEL_PRESETS[presetRaw] || MODEL_PRESETS.fast;

// The local Ollama fallback always uses OLLAMA_MODEL (so a configured OpenAI
// model name is never sent to Ollama). Every hosted OpenAI-compatible runtime —
// official OpenAI, Azure, or a custom base like Groq / Gemini — uses OPENAI_MODEL.
const OPENAI_MODEL = likelyOllama
  ? process.env.OLLAMA_MODEL?.trim() || "llama3.2"
  : process.env.OPENAI_MODEL?.trim() ||
    (isOfficialOpenAI ? presetModel : isAzureOpenAI ? "gpt-4o-mini" : presetModel);

if (isAzureOpenAI && !process.env.OPENAI_MODEL?.trim()) {
  console.warn(
    "[tutor-api] Azure OpenAI: set OPENAI_MODEL to your deployment name (interim default: gpt-4o-mini)."
  );
}

/** Shorter completions = less generation time (optional). */
const OPENAI_MAX_OUTPUT_TOKENS = Math.max(
  0,
  parseInt(String(process.env.OPENAI_MAX_OUTPUT_TOKENS || "0"), 10) || 0
);

if (needsOpenAIKey && !OPENAI_API_KEY) {
  console.warn(
    "[tutor-api] OPENAI_API_KEY is empty — OpenAI and Azure OpenAI require a key (set in api/.env)."
  );
}

console.log(
  `[tutor-api] ${OPENAI_BASE_URL} · model ${OPENAI_MODEL}` +
    (process.env.OPENAI_MODEL?.trim()
      ? " · OPENAI_MODEL"
      : process.env.OLLAMA_MODEL?.trim()
        ? " · OLLAMA_MODEL"
        : isOfficialOpenAI
          ? ` · preset ${presetRaw}`
          : likelyOllama
            ? " · Ollama default"
            : " · custom LLM base")
);

if (likelyOllama) {
  console.log(
    `[tutor-api] On the Ollama machine run once if needed: ollama pull ${OPENAI_MODEL}`
  );
}

/** 0 = unlimited. Caps characters sent in the lab snapshot (reduces model input tokens). */
const LAB_CODE_MAX_CHARS = Math.max(
  0,
  parseInt(String(process.env.LAB_CODE_MAX_CHARS || "0"), 10) || 0
);

/** Collapse long runs of blank lines to save a few tokens (default: on). */
const LAB_COMPACT_BLANK_LINES = process.env.LAB_COMPACT_BLANK_LINES !== "0";

/** Strip trailing spaces per line (default: on). */
const LAB_STRIP_TRAILING_WS = process.env.LAB_STRIP_TRAILING_WS !== "0";

/** Sampling temperature (0–2). Lower tends to follow rules more literally. */
const OPENAI_TEMPERATURE = (() => {
  const v = parseFloat(String(process.env.OPENAI_TEMPERATURE ?? "0.55"));
  if (Number.isNaN(v) || v < 0 || v > 2) return 0.55;
  return v;
})();

// ---------------------------------------------------------------------------
// Course-material grounding (read-only csuf-ssp-oer connection).
// How many passages to retrieve per question and how big the grounding block
// may grow inside the system prompt.
// ---------------------------------------------------------------------------
const OER_TOP_K = Math.max(
  0,
  parseInt(String(process.env.OER_TOP_K || "3"), 10) || 3
);
const OER_CONTEXT_MAX_CHARS = Math.max(
  500,
  parseInt(String(process.env.OER_CONTEXT_MAX_CHARS || "2500"), 10) || 2500
);

/** Keep the Ollama model loaded in memory between turns to avoid reload latency. */
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE?.trim() || "30m";

/** Ollama's native API base (the OpenAI-compatible URL without the /v1 suffix). */
const OLLAMA_HOST = OPENAI_BASE_URL.replace(/\/v1\/?$/, "");

/** Build the read-only index over the csuf-ssp-oer materials once at startup. */
const oer = buildIndex();
/** Whole-program map, computed once, so the tutor understands overall structure. */
const CURRICULUM_OUTLINE = oer.curriculumOutline();
console.log(`[oer] curriculum map ready (${oer.stats().modules} modules).`);
console.log(
  `[tutor-api] speed settings · stream on · model ${OPENAI_MODEL}` +
    ` · max_tokens ${OPENAI_MAX_OUTPUT_TOKENS || "unset"}` +
    ` · OER top-K ${OER_TOP_K} · context ${OER_CONTEXT_MAX_CHARS} chars` +
    (likelyOllama ? ` · keep_alive ${OLLAMA_KEEP_ALIVE}` : "")
);

const TUTOR_SYSTEM_PROMPT = `You are the **Lab tutor** for a university or college hands-on course (labs may include code, HDL, assembly, circuits, or write-ups). Your job is **learning**, not outsourcing graded work.

## Pedagogical stance (non-negotiable)
- **Guide the student toward discovering the answer**: probing questions, reasoning steps, sanity checks, and “what to try next”—not the final deliverable they will submit.
- Assume their work may be **graded** and that giving a full solution can enable misconduct. Prefer scaffolding they still have to **complete with their own reasoning**.
- Meet them where they are: short, clear sentences; define jargon when you use it.

## What you must NOT do
- Do **not** output a **complete lab submission**: no entire ready-to-paste file, no full netlist/module that finishes the assignment, no whole assembly program that satisfies the spec.
- Do **not** fill in **every** blank in a handout template, every missing line in their editor, or a “drop-in replacement” that completes the lab in one shot.
- Do **not** simply rewrite their synced editor into the finished answer—even if they say “fix it for me” or “make it work.”
- If they insist on “the answer,” “full code,” or “just do my lab,” **refuse the shortcut** in one sentence, explain that practice is how they pass the practical, then offer **one** small next step (a question, a test, or a concept to re-read).

## What you MAY do
- Explain **concepts**, **tool/simulator usage**, **syntax and semantics**, and **how to debug** (what signal to watch, what assertion means, how to bisect a bug).
- Point to **categories** of issues suggested by their code (“your sensitivity list may be incomplete,” “this reset might not cover all states”) without pasting the corrected full block that completes the lab.
- Give **tiny illustrative snippets** only when clearly **generic** (different names, toy example) and you label them as **not** their lab solution.
- Offer **checklists**, **“try this / observe that”** flows, and **questions** that force them to connect ideas.
- Describe **regions** of their code in words (“the block that assigns …”) rather than rewriting whole regions verbatim.

## Default reply shape (unless they only asked a yes/no factual)
1) One sentence: reflect what they are trying to accomplish.
2) One focused question **or** one concrete next check/experiment (not the full path to the grade).
3) Optional: a **generic** micro-example or rule—only if it teaches a transferable pattern.
4) Close with something they must **try** and **report back** (what they saw / measured / inferred).

## Using the synced lab editor
- You always receive the current editor snapshot in a fenced block below. Treat it as **ground truth for this turn**.
- Use it to notice likely mistakes or missing pieces **even** when the student only says “help,” “stuck,” or “what next.”
- If the editor is empty or nearly empty, say so gently and suggest how to start (e.g. paste starter from the handout, write a minimal testbench skeleton **they** fill in).

Tone: supportive, honest, and focused on learning—not performative, not preachy.`;

/**
 * Grounding rules appended to (not replacing) the tutor rules above. These keep
 * the same "guide, don't solve" stance while teaching the model how to use the
 * read-only csuf-ssp-oer course materials it is now given each turn.
 */
const OER_GROUNDING_RULES = `## Grounding in course material (csuf-ssp-oer)
- You are given a **curriculum map** of the whole program plus **excerpts** from the official **csuf-ssp-oer** materials (lectures, worksheets, projects, code examples).
- Use the curriculum map to understand how modules and topics fit together, and to point students to the right module/worksheet even when no excerpt is retrieved.
- Each module has multiple worksheets labelled **a, b, c** (in high-school and undergraduate versions). A reference like **"1C"** or **"module 1c"** means **Module 1, Worksheet C** — treat it as valid and help with it; never say a module/worksheet doesn't exist just because of its letter.
- **Prefer the excerpts** when they are relevant, and name the specific module/worksheet so the student can go read it themselves.
- If the materials do not cover the question, say so briefly and answer from general knowledge, staying within the program's scope.
- The materials exist in high-school and undergraduate versions, but **do NOT ask the student which one they are, and do not require being told.** Just help with the module content directly. Infer the right depth from their question and code, and add more technical/implementation detail only when their question clearly calls for it.
- **Answer keys are deliberately withheld from you.** Never claim to have the official solution; guide the student to derive it (this reinforces the rules above — grounding never overrides "guide, don't solve").`;

/**
 * A short, blunt contract placed at the very END of the system prompt. Small
 * local models follow the most-recent instructions best, so this re-states the
 * essentials in a way that is hard to ignore: stay grounded, stay brief, and
 * never hand over a finished solution.
 */
const REPLY_CONTRACT = `## Reply contract (follow this exactly)
- Base your help on the **course material context above**. Do NOT invent module contents, file names, or code that isn't in those excerpts. If the excerpts don't cover it, say so in one line and name the most relevant **Module** by number.
- **Never output a full solution or finished code** — no complete module, program, or step-by-step build of the deliverable. Explain the idea and give ONE next step.
- Be concise: **under ~120 words**, plain sentences. No long numbered walkthroughs, no dumping a design.
- End with one specific question or one small thing for the student to try.`;

/**
 * Parse a module/worksheet reference from the student's text.
 * Handles "module 5", "lab 3", "week 4", and worksheet parts like
 * "module 1c", "worksheet 1-c", "1C" (-> { module: "01", part: "c" }).
 * Returns { module, part } or null when nothing matches.
 */
function moduleHintFromText(text) {
  if (!text) return null;
  const s = String(text);
  const m = s.match(
    /\b(?:module|lab|lecture|worksheet|week|unit|chapter)\s*#?\s*0*(\d{1,2})\s*[-–_ ]?\s*([a-d])?\b/i
  );
  if (!m) return null;
  let part = m[2] ? m[2].toLowerCase() : null;
  // A separately phrased "worksheet c" still pins the part.
  if (!part) {
    const w = s.match(/\bworksheet\s*#?\s*([a-d])\b/i);
    if (w) part = w[1].toLowerCase();
  }
  return { module: m[1].padStart(2, "0"), part };
}

/**
 * Shapes lab text before it is embedded in the system prompt.
 * Tokenization itself is cheap; what matters for latency/cost is how many tokens the model reads.
 * Identical long prefixes across requests may be discounted via provider prompt caching (e.g. OpenAI).
 */
function prepareLabSnapshot(raw) {
  let s = raw == null ? "" : String(raw);

  if (LAB_STRIP_TRAILING_WS) {
    s = s
      .split("\n")
      .map((line) => line.replace(/\s+$/, ""))
      .join("\n");
  }

  if (LAB_COMPACT_BLANK_LINES) {
    s = s.replace(/\n{4,}/g, "\n\n\n");
  }

  if (LAB_CODE_MAX_CHARS > 0 && s.length > LAB_CODE_MAX_CHARS) {
    const marker =
      "\n\n/* ... truncated for context limit: middle of file omitted ... */\n\n";
    const budget = LAB_CODE_MAX_CHARS - marker.length;
    const head = Math.max(0, Math.ceil(budget * 0.45));
    const tail = Math.max(0, Math.floor(budget * 0.55));
    s = s.slice(0, head) + marker + s.slice(-tail);
  }

  return { text: s };
}

/** Pack retrieved OER passages into the system prompt within a char budget. */
function buildContextBlock(sources) {
  if (!sources.length) {
    return "(No matching passages were found in the csuf-ssp-oer materials for this question.)";
  }
  let budget = OER_CONTEXT_MAX_CHARS;
  const parts = [];
  for (const s of sources) {
    const header = `### Source: ${s.label} (${s.source})\n`;
    const remaining = budget - header.length;
    if (remaining <= 0) break;
    const body = s.text.length > remaining ? s.text.slice(0, remaining) : s.text;
    parts.push(header + body);
    budget -= header.length + body.length;
    if (budget <= 0) break;
  }
  return parts.join("\n\n");
}

function buildSystemContent(labCode, sources = []) {
  const trimmed = labCode && String(labCode).trim().length > 0;
  const snapshot = trimmed
    ? prepareLabSnapshot(labCode).text
    : "(Lab editor is empty for this request.)";

  return `${TUTOR_SYSTEM_PROMPT}

${OER_GROUNDING_RULES}

## Curriculum map (from csuf-ssp-oer — your understanding of the whole program)

${CURRICULUM_OUTLINE}

## Course material context (from csuf-ssp-oer — read-only; cite the module/worksheet)

${buildContextBlock(sources)}

## Student lab editor (synced automatically; always read and use in your reply)

\`\`\`
${snapshot}
\`\`\`

${REPLY_CONTRACT}`;
}

/** Build a retrieval query from the latest user turns plus the lab editor. */
function retrievalQueryFrom(outbound, labCode) {
  const lastUser = [...outbound].reverse().find((m) => m.role === "user");
  const priorUser = outbound.filter((m) => m.role === "user").slice(-2, -1)[0];
  return [priorUser?.content, lastUser?.content, labCode].filter(Boolean).join("\n");
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, oer: oer.stats() });
});

/** Inspect what the tutor knows about the OER materials. */
app.get("/api/oer/stats", (_req, res) => {
  res.json(oer.stats());
});

/** The curriculum map + per-module structure the tutor understands. */
app.get("/api/oer/outline", (_req, res) => {
  res.json({ outline: CURRICULUM_OUTLINE, structure: oer.structure() });
});

/** Preview which passages a query would retrieve (handy for debugging grounding). */
app.get("/api/oer/search", (req, res) => {
  const q = String(req.query.q || "");
  res.json({ query: q, results: oer.retrieve(q, { topK: OER_TOP_K }) });
});

app.post("/api/chat", async (req, res) => {
  const { messages, labCode } = req.body || {};

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: "Expected body.messages to be an array." });
  }

  const outbound = messages
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string"
    )
    .map((m) => ({ role: m.role, content: m.content }));

  if (outbound.length === 0) {
    return res.status(400).json({ error: "No valid user/assistant messages." });
  }

  if (needsOpenAIKey && !OPENAI_API_KEY) {
    return res.status(401).json({
      error: "OPENAI_API_KEY is required for OpenAI or Azure OpenAI (set in api/.env).",
    });
  }

  const headers = {
    "Content-Type": "application/json",
  };
  if (OPENAI_API_KEY) {
    headers.Authorization = `Bearer ${OPENAI_API_KEY}`;
  }

  // Ground the answer in the most relevant csuf-ssp-oer passages. If the student
  // names a module/lab number, bias retrieval toward that module's material.
  const lastUserMsg =
    [...outbound].reverse().find((m) => m.role === "user")?.content || "";
  const hint = moduleHintFromText(lastUserMsg);
  const moduleHint = hint?.module || null;
  const partHint = hint?.part || null;
  // Name the worksheet part in the query too, so its terms can also rank.
  const query =
    retrievalQueryFrom(outbound, labCode) +
    (partHint ? ` worksheet ${partHint}` : "");
  const sources =
    OER_TOP_K > 0
      ? oer.retrieve(query, { topK: OER_TOP_K, moduleHint, partHint })
      : [];

  const payload = {
    model: OPENAI_MODEL,
    temperature: OPENAI_TEMPERATURE,
    stream: true,
    messages: [
      { role: "system", content: buildSystemContent(labCode ?? "", sources) },
      ...outbound,
    ],
  };
  if (OPENAI_MAX_OUTPUT_TOKENS > 0) {
    payload.max_tokens = OPENAI_MAX_OUTPUT_TOKENS;
  }
  // Ask Ollama to keep the model resident so later turns skip the reload cost.
  if (likelyOllama) {
    payload.keep_alive = OLLAMA_KEEP_ALIVE;
  }

  // Stream the answer back as newline-delimited JSON events:
  //   {"type":"sources", sources:[...]}  (sent immediately)
  //   {"type":"delta",   text:"..."}     (one per token chunk)
  //   {"type":"done"} | {"type":"error", error, detail?}
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");

  const write = (obj) => {
    if (!res.writableEnded) res.write(JSON.stringify(obj) + "\n");
  };

  // If the browser hits Stop (aborts the fetch), tear down the upstream call.
  const upstream = new AbortController();
  res.on("close", () => upstream.abort());

  write({
    type: "sources",
    sources: sources.map(({ source, label, score }) => ({ source, label, score })),
  });

  try {
    const r = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: upstream.signal,
    });

    if (!r.ok || !r.body) {
      const detail = await r.text().catch(() => "");
      write({
        type: "error",
        error: "Upstream model request failed.",
        detail: detail.slice(0, 2000),
      });
      return res.end();
    }

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line || !line.startsWith("data:")) continue;
        const json = line.slice(5).trim();
        if (json === "[DONE]") continue;
        try {
          const j = JSON.parse(json);
          const delta =
            j?.choices?.[0]?.delta?.content ??
            j?.choices?.[0]?.message?.content ??
            j?.choices?.[0]?.text ??
            "";
          if (delta) write({ type: "delta", text: delta });
        } catch {
          /* ignore partial / non-JSON keepalive lines */
        }
      }
    }

    write({ type: "done" });
    res.end();
  } catch (err) {
    if (upstream.signal.aborted) {
      // Client stopped the request; just close.
      if (!res.writableEnded) res.end();
      return;
    }
    write({ type: "error", error: String(err?.message || err) });
    if (!res.writableEnded) res.end();
  }
});

const webDist = path.resolve(__dirname, "../../web/dist");
if (process.env.SERVE_WEB === "1") {
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(webDist, "index.html"));
    });
    console.log(`Serving web app from ${webDist}`);
  } else {
    console.warn("SERVE_WEB=1 but web/dist is missing — run npm run build from the repo root.");
  }
}

/** True if `have` (e.g. "llama3.2:1b") satisfies the requested model `want`. */
function modelMatches(have, want) {
  if (want.includes(":")) return have === want;
  return have === want || have === `${want}:latest` || have.startsWith(`${want}:`);
}

/** Ask Ollama whether the model is already downloaded locally. */
async function ollamaHasModel(name) {
  const r = await fetch(`${OLLAMA_HOST}/api/tags`);
  if (!r.ok) throw new Error(`HTTP ${r.status} from /api/tags`);
  const data = await r.json();
  const names = (data?.models || []).map((m) => m.name);
  return names.some((m) => modelMatches(m, name));
}

/** Download a model into Ollama, logging progress as it goes. */
async function ollamaPull(name) {
  console.log(
    `[ollama] model "${name}" is not downloaded — pulling now (first run can take a few minutes)...`
  );
  const r = await fetch(`${OLLAMA_HOST}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, stream: true }),
  });
  if (!r.ok || !r.body) {
    const t = await r.text().catch(() => "");
    throw new Error(`pull failed: HTTP ${r.status} ${t.slice(0, 200)}`);
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastStatus = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let j;
      try {
        j = JSON.parse(line);
      } catch {
        continue;
      }
      if (j.error) throw new Error(j.error);
      if (j.status && j.status !== lastStatus) {
        lastStatus = j.status;
        console.log(`[ollama] ${j.status}`);
      }
    }
  }
  console.log(`[ollama] pull complete: ${name}`);
}

/**
 * Send a tiny request so the model is loaded into memory before the first
 * student question. Without this, a cold model can make the first answer take
 * a very long time (it has to load gigabytes from disk first).
 */
async function prewarmModel() {
  if (needsOpenAIKey && !OPENAI_API_KEY) return;
  const headers = { "Content-Type": "application/json" };
  if (OPENAI_API_KEY) headers.Authorization = `Bearer ${OPENAI_API_KEY}`;
  const body = {
    model: OPENAI_MODEL,
    messages: [{ role: "user", content: "ok" }],
    max_tokens: 1,
    stream: false,
  };
  if (likelyOllama) body.keep_alive = OLLAMA_KEEP_ALIVE;
  const t0 = Date.now();
  try {
    const r = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (r.ok) {
      console.log(
        `[tutor-api] model ${OPENAI_MODEL} ready (loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s).`
      );
    } else {
      console.warn(`[tutor-api] warm-up got HTTP ${r.status} (will load on first question).`);
    }
  } catch (e) {
    console.warn(`[tutor-api] warm-up skipped: ${String(e?.message || e)}`);
  }
}

/**
 * On launch, guarantee the model is ready to answer:
 *  - hosted (OpenAI/Azure): just a quick warm-up ping.
 *  - local (Ollama): make sure the model is downloaded (auto-pull if missing,
 *    i.e. it has "gone cold"), then load it into memory.
 */
async function ensureModelReady() {
  if (!likelyOllama) {
    await prewarmModel();
    return;
  }
  try {
    if (!(await ollamaHasModel(OPENAI_MODEL))) {
      await ollamaPull(OPENAI_MODEL);
    }
  } catch (e) {
    console.warn(
      `[ollama] could not prepare model "${OPENAI_MODEL}": ${String(e?.message || e)}`
    );
    console.warn(
      `[ollama] make sure Ollama is running (ollama serve) — it will be loaded on first use otherwise.`
    );
    return;
  }
  await prewarmModel();
}

app.listen(PORT, () => {
  console.log(`Tutor API listening on http://localhost:${PORT}`);
  void ensureModelReady();
});
