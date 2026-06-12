# Lab tutor (`tutor-chat-bot`)

AI lab tutor with a code workspace and chat panel. It **guides students** through course modules (does not paste full solutions) and grounds answers in the **csuf-ssp-oer** course materials.

## What you need on a new computer

| Requirement | Notes |
|-------------|--------|
| **Node.js 18+** | [nodejs.org](https://nodejs.org/) — includes `npm` |
| **This repo** | The `tutor-chat-bot` folder only (course materials load from S3 at startup) |
| **Groq API key** | Ask your team lead (not stored in git — GitHub blocks API keys in the repo) |

You do **not** need a separate `csuf-ssp-oer` checkout. You do **not** need Docker unless you want to run Ollama in a container.

### Course materials (AWS S3 — not in the repo)

Lectures, worksheets, and projects live on **AWS S3**. Students only clone `tutor-chat-bot`; on startup the API reads objects from S3 **in memory** and builds the tutor index (no local `course-materials/` folder required).

**Not in GitHub (gitignored):** `course-materials.config.json` — read-only S3 keys (GitHub blocks AWS secrets in the repo). Copy from the example file and ask your team lead for the keys.

**Never on S3:** answer-key folders (`worksheet_keys`, `projects_keys`, etc.).

```
tutor-chat-bot/
├── course-materials.config.example.json   ← template (in repo)
├── course-materials.config.json           ← your local copy with keys (gitignored)
├── api/
└── web/
```

#### One-time AWS setup (maintainer)

1. Create an S3 bucket (e.g. `tutor-updates`).
2. Create an IAM user with **read-only** access to `s3://your-bucket/course-materials/*`.
3. Copy `course-materials.config.example.json` → `course-materials.config.json` and fill in bucket, region, and the **read-only** keys (do **not** commit this file).
5. In **`csuf-ssp-oer/aws-updater`**, set `AWS_BUCKET` (upload IAM keys live there for maintainers).
6. Push materials from the OER repo to S3 (skips answer keys automatically):

```bash
npm run upload:oer
```

When `csuf-ssp-oer` changes: run `npm run upload:oer` again.

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

**Optional:** force re-download from S3 on next start:

```env
OER_REFRESH_S3=1
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

1. Clone **`tutor-chat-bot`**, then copy `course-materials.config.example.json` → `course-materials.config.json` and add the read-only S3 keys from your team lead.
2. Install **Node.js 18+**.
3. Run `npm install` inside `tutor-chat-bot`.
4. Create **`api/.env`** — copy the block from step 2 and paste in the Groq key from your team lead.
5. Run `npm run serve`.
6. Open **http://localhost:5173**.

On first `npm run serve`, course materials are read from S3 and indexed for the tutor chatbot.

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
