# Lab tutor (`tutor-chat-bot`)

AI lab tutor with a code workspace and chat panel. It **guides students** through CSUF SSP course modules (does not paste full solutions) and grounds answers in course materials stored on **AWS S3**.

---

## What you need

| Requirement | Notes |
|-------------|--------|
| **Node.js 18+** | [nodejs.org](https://nodejs.org/) — includes `npm` |
| **This repo** | Clone `tutor-chat-bot` |
| **Groq API key** | From your team lead — you paste it into `api/.env` (see Step 3) |

S3 bucket + read-only AWS keys are already in `course-materials.config.json` on GitHub. **Answer keys are never uploaded, downloaded, or indexed.**

---

## Where to put credentials (exact files)

### Groq key — you create this file: `api/.env`

| What | Exact value |
|------|-------------|
| **File path** | `tutor-chat-bot/api/.env` |
| **Variable name** | `OPENAI_API_KEY` |
| **What to paste** | Groq key from your team lead (starts with `gsk_`) |

Also include these lines in the same file (do not change them):

| Variable | Value |
|----------|-------|
| `OPENAI_BASE_URL` | `https://api.groq.com/openai/v1` |
| `OPENAI_MODEL` | `llama-3.3-70b-versatile` |

**Full file contents** — replace only `YOUR_GROQ_KEY`:

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

> `api/.env` is **not** on GitHub. Create it yourself in Step 3.

---

### AWS S3 reader key — already in the repo: `course-materials.config.json`

| Field | Value |
|-------|-------|
| **File path** | `tutor-chat-bot/course-materials.config.json` |
| `bucket` | `tutor-updates` |
| `region` | `us-west-1` |
| `prefix` | `course-materials/` |
| `accessKeyId` | Already set after clone (read-only `tutor-reader` key) |
| `secretAccessKey` | Already set after clone |

You do **not** edit this file unless your team lead gives you new keys.

---

## Quick start (students) — step by step

### Step 1 — Clone the repo

**Windows (PowerShell):**

```powershell
cd C:\Users\kaito\codes
git clone https://github.com/VanessaIH/ai_tutor.git
cd ai_tutor\tutor-chat-bot
```

**Mac / Linux:**

```bash
cd ~/codes
git clone https://github.com/VanessaIH/ai_tutor.git
cd ai_tutor/tutor-chat-bot
```

Confirm S3 config is present:

```powershell
dir course-materials.config.json
```

Mac/Linux: `ls course-materials.config.json`

### Step 2 — Install dependencies

```bash
npm install
```

### Step 3 — Create `api/.env` and paste your Groq key

This is the **only file you must create yourself.**

**Windows (PowerShell)** — run from inside `tutor-chat-bot`:

```powershell
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

**Mac / Linux:**

```bash
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
```

**Then open `api/.env` in any text editor** and replace `YOUR_GROQ_KEY` with the key your team lead sent you.

The line must look like this (example format only):

```env
OPENAI_API_KEY=gsk_pasteYourKeyHere
```

Save the file. Do **not** commit `api/.env` to git.

### Step 4 — (Optional) Verify S3 course materials connect

```bash
npm run index:oer -w api
```

**Success looks like:**

```
[oer-s3] indexed 57 files from s3://tutor-updates/course-materials/
files:   57
chunks:  104
modules: 7
```

### Step 5 — Start the tutor

```bash
npm run serve
```

**Success looks like:**

```
[web]   ➜  Local:   http://localhost:5173/
[api]   [oer] curriculum map ready (7 modules).
[api]   Tutor API listening on http://localhost:3001
```

### Step 6 — Open the app

Go to **http://localhost:5173**

### Step 7 — Stop the server

Press **Ctrl+C** in the terminal.

---

## Using the tutor

- **Code panel (top):** paste lab code (Verilog, Python, etc.)
- **Chat panel (bottom):** ask questions
- **HS / UG track:** pick High School or Undergraduate
- **Module worksheets:** **1C** = Module 1, Worksheet C

The tutor will **not** give full solutions or answer keys.

---

## Maintainer guide — updating course materials on S3

| What | File |
|------|------|
| Groq key | `api/.env` (local, not in git) |
| S3 reader key + bucket | `course-materials.config.json` (in repo) |
| S3 upload key | `csuf-ssp-oer/aws-updater` |

```bash
cd tutor-chat-bot
npm run upload:oer
npm run serve
```

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| `OPENAI_API_KEY is required` | Create `api/.env` and set `OPENAI_API_KEY` to your Groq key. |
| `EADDRINUSE` | Press `Ctrl+C`, run `npm run serve` again. |
| `missing read-only AWS keys` | Check `course-materials.config.json` exists after clone. |
| `AccessDenied` on S3 | Ask team lead for new `tutor-reader` keys. |
| `files: 0` | Maintainer runs `npm run upload:oer`. |
| Groq rate limit | Wait 1 minute, try a shorter question. |

---

## New machine checklist

1. Install Node.js 18+
2. `git clone https://github.com/VanessaIH/ai_tutor.git`
3. `cd ai_tutor/tutor-chat-bot`
4. `npm install`
5. **Create `api/.env`** — paste Groq key into `OPENAI_API_KEY` (Step 3)
6. `npm run serve`
7. Open http://localhost:5173
