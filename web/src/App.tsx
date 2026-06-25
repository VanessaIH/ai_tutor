import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import "./App.css";

type Role = "user" | "assistant";

interface Source {
  source: string;
  label: string;
  score: number;
}

interface ChatTurn {
  role: Role;
  content: string;
  sources?: Source[];
}

const LAB_STORAGE_KEY = "tutor-chat-bot-lab-code";
const TRACK_STORAGE_KEY = "tutor-chat-bot-track";

type Track = "hs" | "ug" | null;

/** Collapse repeated passages from the same file into one chip, keeping order. */
function dedupeSources(sources: Source[]): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of sources) {
    if (seen.has(s.source)) continue;
    seen.add(s.source);
    out.push(s);
  }
  return out;
}

function getApiBase(): string {
  const raw = import.meta.env.VITE_API_URL as string | undefined;
  return raw?.trim().replace(/\/+$/, "") ?? "";
}

function getChatApiUrl(): string {
  const base = getApiBase();
  if (base) return `${base}/api/chat`;
  return "/api/chat";
}

function getHealthApiUrl(): string {
  const base = getApiBase();
  if (base) return `${base}/api/health`;
  return "/api/health";
}

/** Detect HS/UG in the student's message so track persists after they reply. */
function trackFromText(text: string): Track | null {
  if (/\b(hs|high\s*school(?:er)?|highschool)\b/i.test(text)) return "hs";
  if (/\b(ug|undergrad(?:uate)?)\b/i.test(text)) return "ug";
  return null;
}

function formatChatError(error?: string, detail?: string): string {
  const blob = `${error || ""} ${detail || ""}`.toLowerCase();
  if (
    /rate.?limit|too many requests|tokens per day|token/.test(blob) ||
    /\b429\b/.test(blob)
  ) {
    return (
      "The tutor hit an API rate or daily limit. " +
      "Refresh the page, wait about a minute, then try a shorter question. " +
      "The tutor still won't paste full lab code — it guides with questions and small generic examples only."
    );
  }
  const detailBlock = detail ? `\n\n${detail}` : "";
  return `Request failed: ${error || "Unknown error"}${detailBlock}`;
}

export default function App() {
  const chatApiUrl = useMemo(() => getChatApiUrl(), []);
  const healthApiUrl = useMemo(() => getHealthApiUrl(), []);

  const [labCode, setLabCode] = useState("");
  const [track, setTrack] = useState<Track>(null);
  const [messages, setMessages] = useState<ChatTurn[]>([
    {
      role: "assistant",
      content:
        "Hi — I’m your lab tutor. I read your code workspace on every message, but I won’t paste a fixed or finished version — I’ll ask questions, suggest checks, and use small generic examples only. If you ask about a module without saying HS or UG, I’ll ask which track you’re on. You can also pick **HS** or **UG** above anytime.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  /** A question typed while the tutor is still answering; sent automatically after. */
  const [queued, setQueued] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<"unknown" | "ok" | "error">(
    "unknown"
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Latest messages, so an in-flight send always builds on current history. */
  const messagesRef = useRef<ChatTurn[]>(messages);
  /** Lets the Stop button abort the in-flight request. */
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const lineCount = useMemo(() => {
    if (!labCode) return 0;
    return labCode.split(/\n/).length;
  }, [labCode]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LAB_STORAGE_KEY);
      if (saved) setLabCode(saved);
      const savedTrack = localStorage.getItem(TRACK_STORAGE_KEY);
      if (savedTrack === "hs" || savedTrack === "ug") setTrack(savedTrack);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LAB_STORAGE_KEY, labCode);
    } catch {
      /* ignore */
    }
  }, [labCode]);

  useEffect(() => {
    try {
      if (track) localStorage.setItem(TRACK_STORAGE_KEY, track);
      else localStorage.removeItem(TRACK_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, [track]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      try {
        const r = await fetch(healthApiUrl);
        if (!cancelled) setApiStatus(r.ok ? "ok" : "error");
      } catch {
        if (!cancelled) setApiStatus("error");
      }
    };
    void ping();
    const id = window.setInterval(ping, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [healthApiUrl]);

  const doSend = useCallback(
    async (text: string) => {
      const userTurn: ChatTurn = { role: "user", content: text };
      const history = [...messagesRef.current, userTurn];
      setMessages(history);
      setLoading(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const inferredTrack = trackFromText(text);
      const effectiveTrack = inferredTrack ?? track;
      if (inferredTrack) setTrack(inferredTrack);

      const payload: {
        messages: { role: Role; content: string }[];
        labCode: string;
        audience?: Track;
      } = {
        messages: history.map(({ role, content }) => ({ role, content })),
        labCode,
      };
      if (effectiveTrack) payload.audience = effectiveTrack;

      // The assistant turn grows as streamed tokens arrive.
      const assistant: ChatTurn = { role: "assistant", content: "" };
      let started = false;
      const flush = () => setMessages([...history, { ...assistant }]);

      const handleEvent = (evt: {
        type: string;
        text?: string;
        sources?: Source[];
        error?: string;
        detail?: string;
      }) => {
        if (evt.type === "sources") {
          assistant.sources = evt.sources;
          if (started) flush();
        } else if (evt.type === "delta" && evt.text) {
          assistant.content += evt.text;
          started = true;
          flush();
        } else if (evt.type === "error") {
          assistant.content =
            (assistant.content ? assistant.content + "\n\n" : "") +
            formatChatError(evt.error, evt.detail);
          flush();
        }
      };

      try {
        const res = await fetch(chatApiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        // Validation errors (no key, bad body) come back as plain JSON.
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
            detail?: string;
          };
          assistant.content = formatChatError(
            data.error || `HTTP ${res.status}`,
            data.detail
          );
          flush();
          return;
        }

        if (!res.body) {
          assistant.content = "(No response stream from server.)";
          flush();
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            try {
              handleEvent(JSON.parse(line));
            } catch {
              /* ignore partial line */
            }
          }
        }
        const tail = buffer.trim();
        if (tail) {
          try {
            handleEvent(JSON.parse(tail));
          } catch {
            /* ignore */
          }
        }

        if (!assistant.content.trim()) {
          assistant.content = "(Empty reply from model.)";
          flush();
        }
      } catch (e) {
        if (controller.signal.aborted) {
          assistant.content =
            (assistant.content ? assistant.content + "\n\n" : "") + "⏹ Stopped.";
          flush();
        } else {
          assistant.content = `Could not reach the tutor API at:\n${chatApiUrl}\n\nStart the API (port 3001) and use “npm run dev” from the project root, or set VITE_API_URL in web/.env — see web/.env.example.\n\n${String(e)}`;
          flush();
        }
      } finally {
        abortRef.current = null;
        setLoading(false);
      }
    },
    [labCode, track, chatApiUrl]
  );

  /** Enter / Send: send now if idle, otherwise hold the question until the tutor finishes. */
  const submit = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    if (loading) {
      setQueued(text);
      return;
    }
    void doSend(text);
  }, [input, loading, doSend]);

  /** Stop the in-flight answer. */
  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Once the tutor finishes (loading clears), release any held question.
  useEffect(() => {
    if (!loading && queued) {
      const next = queued;
      setQueued(null);
      void doSend(next);
    }
  }, [loading, queued, doSend]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const syncLabel =
    labCode.trim().length === 0
      ? "Buffer empty"
      : `${lineCount} line${lineCount === 1 ? "" : "s"} · synced each send`;

  const statusLabel =
    apiStatus === "ok"
      ? "API online"
      : apiStatus === "error"
        ? "API offline"
        : "Checking…";

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              <path d="M8 7h8M8 11h6" />
            </svg>
          </div>
          <div className="brand-text">
            <h1>Lab tutor</h1>
            <p className="tagline">Code workspace · guided learning</p>
          </div>
        </div>
        <div className="header-right">
          <div
            className={`api-status api-status--${apiStatus}`}
            role="status"
            aria-live="polite"
          >
            <span className="api-status-dot" aria-hidden />
            {statusLabel}
          </div>
          <p className="app-header-meta">
            Your editor is sent with every message so answers match your current
            lab code.
          </p>
        </div>
      </header>

      <div className="body-split">
      <main className="workspace" aria-label="Code workspace">
        <div className="workspace-toolbar">
          <span className="workspace-label">
            <svg className="workspace-label-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
            Code space
          </span>
          <span className="workspace-meta">{syncLabel}</span>
        </div>
        <div className="code-editor-wrap">
          <div className="code-gutter" aria-hidden />
          <textarea
            className="code-editor"
            value={labCode}
            onChange={(e) => setLabCode(e.target.value)}
            placeholder="// Paste or write your lab code here…"
            spellCheck={false}
            aria-label="Lab code editor"
          />
        </div>
      </main>

      <section className="chat-dock" aria-label="Lab tutor chat">
        <div className="chat-dock-head">
          <div className="chat-dock-title-wrap">
            <svg className="chat-dock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span className="chat-dock-title">Tutor</span>
          </div>
          <div className="chat-dock-controls">
            <div
              className="track-select"
              role="group"
              aria-label="Worksheet track"
            >
              <span className="track-select-label">Track</span>
              <button
                type="button"
                className={`track-btn${track === "hs" ? " track-btn--active" : ""}`}
                aria-pressed={track === "hs"}
                title="High School"
                onClick={() => setTrack("hs")}
              >
                HS
              </button>
              <button
                type="button"
                className={`track-btn${track === "ug" ? " track-btn--active" : ""}`}
                aria-pressed={track === "ug"}
                title="Undergraduate"
                onClick={() => setTrack("ug")}
              >
                UG
              </button>
            </div>
            <span
              className="sync-pill"
              title="The server includes this editor snapshot in every model request"
            >
              Code in every request
            </span>
          </div>
        </div>
        <div
          className="chat-scroll"
          ref={scrollRef}
          aria-live="polite"
          aria-relevant="additions"
        >
          {messages.map((m, i) => (
            <div
              key={i}
              className={`msg-row ${m.role === "user" ? "msg-row-user" : ""}`}
            >
              <div
                className={`msg-avatar ${m.role === "user" ? "msg-avatar-user" : "msg-avatar-tutor"}`}
                aria-hidden
              >
                {m.role === "user" ? "U" : "T"}
              </div>
              <div className="msg-content">
                <div
                  className={`bubble ${m.role === "user" ? "bubble-user" : "bubble-assistant"}`}
                >
                  {m.content}
                </div>
                {m.role === "assistant" &&
                  m.sources &&
                  m.sources.length > 0 && (
                    <div className="sources" aria-label="Course material sources">
                      <span className="sources-label">From the course materials</span>
                      <div className="source-chips">
                        {dedupeSources(m.sources).map((s) => (
                          <span
                            key={s.source}
                            className="source-chip"
                            title={s.source}
                          >
                            {s.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            </div>
          ))}
          {loading && messages[messages.length - 1]?.role === "user" && (
            <div className="typing" aria-busy="true">
              <div className="typing-dots" aria-hidden>
                <span />
                <span />
                <span />
              </div>
              Tutor is thinking…
            </div>
          )}
        </div>
        {queued && (
          <div className="queued-banner" role="status" aria-live="polite">
            <span className="queued-dot" aria-hidden />
            <span className="queued-text">
              Queued — sends when the tutor finishes: “{queued}”
            </span>
            <button
              type="button"
              className="queued-cancel"
              onClick={() => setQueued(null)}
              aria-label="Cancel queued question"
            >
              Cancel
            </button>
          </div>
        )}
        <div className="chat-compose">
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <div className="hint-row">
              <span className="kbd">Enter</span>
              <span style={{ color: "var(--text-muted)", fontSize: "0.65rem" }}>
                {loading ? "queue next" : "send"}
              </span>
              <span className="kbd">Shift+Enter</span>
              <span style={{ color: "var(--text-muted)", fontSize: "0.65rem" }}>
                newline
              </span>
            </div>
            <textarea
              className="chat-input"
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={
                loading
                  ? "Tutor is answering… type your next question and press Enter to queue it"
                  : "Ask a conceptual question or where you’re stuck…"
              }
              aria-label="Message to tutor"
            />
          </div>
          {loading ? (
            <button
              type="button"
              className="stop-btn"
              onClick={stop}
              aria-label="Stop the tutor's current answer"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden width="14" height="14">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="send-btn"
              disabled={!input.trim()}
              onClick={submit}
            >
              Send
            </button>
          )}
        </div>
        {import.meta.env.DEV && (
          <p className="api-hint">Dev · POST {chatApiUrl}</p>
        )}
      </section>
      </div>
    </div>
  );
}
