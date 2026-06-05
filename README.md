# Lab tutor (`tutor-chat-bot`)

AI lab tutor with a code workspace and chat panel. It **guides students** through course modules (does not paste full solutions) and grounds answers in the **csuf-ssp-oer** course materials.

## What you need on a new computer

| Requirement | Notes |
|-------------|--------|
| **Node.js 18+** | [nodejs.org](https://nodejs.org/) — includes `npm` |
| **This repo** | The `tutor-chat-bot` folder |
| **Course materials** | The `csuf-ssp-oer` folder (lectures, worksheets, projects) |
| **Groq API key** | Ask your team lead (not stored in git — GitHub blocks API keys in the repo) |

You do **not** need Docker unless you want to run Ollama in a container.

### Recommended folder layout

Put `csuf-ssp-oer` next to `tutor-chat-bot` (sibling folders). The API looks there by default:

```
faller-ai-tutor/
├── tutor-chat-bot/     ← this project
└── csuf-ssp-oer/       ← course content (required for module grounding)
```

If your materials live somewhere else, set `OER_CONTENT_PATH` in `api/.env` (see below).

---

## First-time setup

Open a terminal in the `tutor-chat-bot` folder.

### 1. Install dependencies

```bash
npm install
```

### 2. Configure the API

Create `api/.env` with this content. Replace `YOUR_GROQ_KEY` with the shared test key from your team lead:

```env
PORT=3001

OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_API_KEY=YOUR_GROQ_KEY
OPENAI_MODEL=llama-3.3-70b-versatile

OPENAI_MAX_OUTPUT_TOKENS=600
OPENAI_TEMPERATURE=0.3

OER_TOP_K=4
OER_CONTEXT_MAX_CHARS=2600
```

**Course materials path** — only change this if `csuf-ssp-oer` is not in the default sibling folder:

```env
OER_CONTENT_PATH=../csuf-ssp-oer
```

> **Note:** `api/.env` is gitignored. GitHub will **reject pushes** that contain API keys in any committed file (including this README). Share the Groq key with your team privately (chat, email, etc.).

### 3. (Optional) Verify OER connection

```bash
npm run index:oer -w api
```

You should see chunk/file counts and a sample retrieval. If the path is wrong, fix `OER_CONTENT_PATH`.

---

## Run the tutor

### Normal use (recommended)

Stable mode — API does not auto-restart mid-chat:

```bash
npm run serve
```

Then open **http://localhost:5173** in your browser.

- **Web UI:** http://localhost:5173  
- **API:** http://localhost:3001  

### Development (auto-restart on code changes)

```bash
npm run dev
```

Use this only while editing the project. The API may restart during a chat and briefly interrupt a reply.

### Stop

Press `Ctrl+C` in the terminal where the server is running.

---

## Using the tutor

- **Code panel (top):** paste lab code — it is sent with every message.
- **Chat panel (bottom):** ask questions; answers stream in.
- **HS / UG track:** worksheets exist in two versions:
  - **HS** — High School
  - **UG** — Undergraduate  
  If you ask about a module without saying HS or UG (and have not picked a track), the tutor asks which one you are on before explaining.
- **Module worksheets:** names like **1C** mean Module 1, Worksheet C.
- **Stop** button cancels a long reply; you can type the next question while waiting (it queues).

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| `EADDRINUSE` on port 3001 or 5173 | Another copy is still running. Stop it (`Ctrl+C`) or close the old terminal. |
| Tutor is slow or hangs | If using Ollama on CPU, responses can take minutes. Switch to Groq in `api/.env`. |
| No course sources shown | Check `csuf-ssp-oer` path; run `npm run index:oer -w api`. |
| `OPENAI_API_KEY is required` | You set an OpenAI/Azure URL but left the key empty. |
| Changes to `api/.env` not picked up | Restart the server (`Ctrl+C`, then `npm run serve` again). |

**Health check:**

```bash
curl http://localhost:3001/api/health
```

Should return `"ok": true` and OER stats.

---

## Project structure

```
tutor-chat-bot/
├── api/                 # Express backend
│   ├── src/index.js     # Chat API, streaming, prompts
│   ├── src/oer.js       # Course-material indexing & retrieval
│   └── .env             # API settings (paste from this README)
├── web/                 # React + Vite frontend
│   └── src/App.tsx      # Code editor + chat UI
└── package.json         # npm workspaces (api + web)
```

---

## Scripts reference

| Command | Purpose |
|---------|---------|
| `npm run serve` | Run tutor for normal use (stable API) |
| `npm run dev` | Run with API auto-restart (development) |
| `npm run build` | Build the web app for production |
| `npm run start` | API only (after `npm run build` if serving static web) |
| `npm run index:oer -w api` | Test OER indexing without starting the server |
| `npm run ollama:up` | Start Ollama via Docker (optional) |

---

## Copying to another machine (checklist)

1. Copy **`tutor-chat-bot`** and **`csuf-ssp-oer`** (or know where OER lives).
2. Install **Node.js 18+**.
3. Run `npm install` inside `tutor-chat-bot`.
4. Create **`api/.env`** — copy the block from step 2 and paste in the Groq key from your team lead.
5. Run `npm run serve`.
6. Open **http://localhost:5173**.

No other downloads are required unless you choose Ollama or Docker for local models.

---

## Terminal commands (copy-paste)

Use your project path if it differs from the example below.

### Windows (PowerShell)

```powershell
cd C:\path\to\faller-ai-tutor\tutor-chat-bot

npm install

@"
PORT=3001

OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_API_KEY=YOUR_GROQ_KEY
OPENAI_MODEL=llama-3.3-70b-versatile

OPENAI_MAX_OUTPUT_TOKENS=600
OPENAI_TEMPERATURE=0.3

OER_TOP_K=4
OER_CONTEXT_MAX_CHARS=2600
"@ | Set-Content -Path api\.env -Encoding utf8
```

Replace `YOUR_GROQ_KEY` in `api\.env` with the key from your team lead, then run:

```powershell

npm run serve
```

Then open **http://localhost:5173** in your browser.

Optional — check that course materials are connected:

```powershell
npm run index:oer -w api
```

Optional — health check while the server is running:

```powershell
curl.exe http://localhost:3001/api/health
```

Stop the server: press **Ctrl+C** in the same terminal.

### Mac / Linux (bash)

```bash
cd /path/to/faller-ai-tutor/tutor-chat-bot

npm install

cat > api/.env <<'EOF'
PORT=3001

OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_API_KEY=YOUR_GROQ_KEY
OPENAI_MODEL=llama-3.3-70b-versatile

OPENAI_MAX_OUTPUT_TOKENS=600
OPENAI_TEMPERATURE=0.3

OER_TOP_K=4
OER_CONTEXT_MAX_CHARS=2600
EOF

# Replace YOUR_GROQ_KEY in api/.env with the key from your team lead

npm run serve
```

Then open **http://localhost:5173** in your browser.

Stop the server: press **Ctrl+C** in the same terminal.
