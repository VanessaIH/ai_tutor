/**
 * Serialize upstream LLM calls and retry on rate limits (OpenRouter/Groq 429, etc.).
 * Helps a shared hosted key survive lab-hour bursts on free tier.
 */

const MAX_CONCURRENT = Math.max(
  1,
  parseInt(String(process.env.LLM_MAX_CONCURRENT || "2"), 10) || 2
);
const MIN_INTERVAL_MS = Math.max(
  0,
  parseInt(String(process.env.LLM_MIN_INTERVAL_MS || "400"), 10) || 0
);
const RETRY_MAX = Math.max(
  0,
  parseInt(String(process.env.LLM_RETRY_MAX || "4"), 10) || 0
);
const RETRY_BASE_MS = Math.max(
  200,
  parseInt(String(process.env.LLM_RETRY_BASE_MS || "1000"), 10) || 1000
);

const GATE_ENABLED = process.env.LLM_GATE === "0" ? false : true;

let active = 0;
const waitQueue = [];
let lastDispatchAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function drainQueue() {
  while (active < MAX_CONCURRENT && waitQueue.length > 0) {
    const job = waitQueue.shift();
    active++;
    (async () => {
      try {
        const now = Date.now();
        const gap = MIN_INTERVAL_MS - (now - lastDispatchAt);
        if (gap > 0) await sleep(gap);
        lastDispatchAt = Date.now();
        job.resolve(await job.run());
      } catch (err) {
        job.reject(err);
      } finally {
        active--;
        drainQueue();
      }
    })();
  }
}

/** Run `fn` when a concurrency slot is available (FIFO queue). */
export function runWithLlmGate(fn) {
  if (!GATE_ENABLED) return fn();
  return new Promise((resolve, reject) => {
    waitQueue.push({ run: fn, resolve, reject });
    drainQueue();
  });
}

export function llmGateStats() {
  return {
    enabled: GATE_ENABLED,
    maxConcurrent: MAX_CONCURRENT,
    minIntervalMs: MIN_INTERVAL_MS,
    retryMax: RETRY_MAX,
    active,
    queued: waitQueue.length,
  };
}

export function logLlmGateConfig() {
  if (!GATE_ENABLED) {
    console.log("[llm-gate] disabled (LLM_GATE=0)");
    return;
  }
  console.log(
    `[llm-gate] max ${MAX_CONCURRENT} concurrent · ${MIN_INTERVAL_MS}ms spacing · up to ${RETRY_MAX} retries on 429`
  );
}

function parseRetryAfterMs(header) {
  if (!header) return null;
  const trimmed = String(header).trim();
  const seconds = Number(trimmed);
  if (!Number.isNaN(seconds) && seconds > 0) return seconds * 1000;
  return null;
}

export function isRetryableLlmStatus(status, detail) {
  if (status === 429 || status === 503 || status === 502) return true;
  const d = String(detail || "").toLowerCase();
  return /\brate.?limit|too many requests|tokens per (minute|day)/i.test(d);
}

/**
 * fetch() with exponential backoff on rate-limit responses.
 * Returns a Response (body unread on success; body as text on final failure).
 */
export async function fetchLlmWithRetry(url, init) {
  let lastResponse = null;
  let lastDetail = "";

  for (let attempt = 0; attempt <= RETRY_MAX; attempt++) {
    const r = await fetch(url, init);
    if (r.ok) return r;

    const detail = await r.text().catch(() => "");
    lastResponse = r;
    lastDetail = detail;

    const canRetry = isRetryableLlmStatus(r.status, detail) && attempt < RETRY_MAX;
    if (!canRetry) {
      return new Response(detail, {
        status: r.status,
        statusText: r.statusText,
        headers: r.headers,
      });
    }

    const retryAfter = parseRetryAfterMs(r.headers.get("retry-after"));
    const jitter = Math.floor(Math.random() * 400);
    const backoff = retryAfter ?? RETRY_BASE_MS * 2 ** attempt + jitter;
    console.warn(
      `[llm-gate] upstream HTTP ${r.status} — retry ${attempt + 1}/${RETRY_MAX} in ${Math.round(backoff)}ms`
    );
    await sleep(backoff);
  }

  return new Response(lastDetail, {
    status: lastResponse?.status ?? 429,
    statusText: lastResponse?.statusText ?? "Too Many Requests",
    headers: lastResponse?.headers,
  });
}
