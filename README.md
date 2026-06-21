# Lab tutor (`tutor-chat-bot`)

AI lab tutor with a code workspace and chat panel. It **guides students** through CSUF SSP course modules (does not paste full solutions) and grounds answers in course materials stored on **AWS S3**.

---

## What you need

| Requirement | Notes |
|-------------|--------|
| **Node.js 18+** | [nodejs.org](https://nodejs.org/) — includes `npm` |
| **This repo** | Clone from GitHub |
| **Groq API key** | From your team lead → goes in `api/.env` |
| **S3 reader keys** | From your team lead → goes in `api/.env` |

The S3 **bucket name and region** are in `course-materials.config.json` (on GitHub). **No secrets are in the repo** — keys are shared privately, like Groq.

**Answer keys are never uploaded, downloaded, or indexed.**

---

## Where to put credentials — one file: `api/.env`

**File path:** `tutor-chat-bot/api/.env`  
**This file is gitignored — never commit it.**

| Variable | What to paste | From team lead |
|----------|---------------|----------------|
| `OPENAI_API_KEY` | Groq key (starts with `gsk_`) | Yes |
| `AWS_ACCESS_KEY_ID` | S3 read-only access key (starts with `AKIA`) | Yes |
| `AWS_SECRET_ACCESS_KEY` | Matching S3 secret key | Yes |

Leave these lines as-is (do not change):

| Variable | Value |
|----------|-------|
| `OPENAI_BASE_URL` | `https://api.groq.com/openai/v1` |
| `OPENAI_MODEL` | `llama-3.3-70b-versatile` |

S3 bucket info comes from `course-materials.config.json` automatically (`tutor-updates`, `us-west-1`).

---

## Quick start (students) — step by step

### Step 1 — Clone the repo

**Windows (PowerShell):**

```powershell
cd C:\Users\jfall\Desktop\Repos
git clone https://github.com/VanessaIH/ai_tutor.git
cd ai_tutor
git pull origin main
```

**Mac / Linux:**

```bash
cd ~/codes
git clone https://github.com/VanessaIH/ai_tutor.git
cd ai_tutor
git pull origin main
```

### Step 2 — Install dependencies

```powershell
npm install
```

### Step 3 — Create `api/.env` with Groq + S3 keys

Replace the three placeholders with keys from your team lead.

**Windows (PowerShell):**

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

AWS_ACCESS_KEY_ID=YOUR_S3_READ_ACCESS_KEY
AWS_SECRET_ACCESS_KEY=YOUR_S3_READ_SECRET_KEY
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

AWS_ACCESS_KEY_ID=YOUR_S3_READ_ACCESS_KEY
AWS_SECRET_ACCESS_KEY=YOUR_S3_READ_SECRET_KEY
EOF
```

**Then open `api/.env` in a text editor** and replace:

- `YOUR_GROQ_KEY` → your `gsk_...` key
- `YOUR_S3_READ_ACCESS_KEY` → your `AKIA...` key
- `YOUR_S3_READ_SECRET_KEY` → your S3 secret key

Example (format only):

```env
OPENAI_API_KEY=gsk_xxxxxxxx
AWS_ACCESS_KEY_ID=AKIAxxxxxxxx
AWS_SECRET_ACCESS_KEY=xxxxxxxx
```

Save the file. **Do not commit `api/.env` to git.**

You can also copy `api/.env.example` → `api/.env` and fill in the three placeholders.

### Step 4 — Verify S3 course materials connect

```powershell
npm run index:oer -w api
```

**Success looks like:**

```
[oer-s3] indexed 57 files from s3://tutor-updates/course-materials/
files:   57
chunks:  104
modules: 7
```

If you see `missing read-only AWS keys`, check `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in `api/.env`.

### Step 5 — Start the tutor

```powershell
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

## What's on GitHub vs local

| Item | On GitHub? | Where |
|------|------------|-------|
| S3 bucket / region / prefix | Yes | `course-materials.config.json` |
| Groq key | **No** | `api/.env` |
| S3 reader keys | **No** | `api/.env` |
| S3 upload keys | **No** | `csuf-ssp-oer/aws-updater` (maintainers only) |

---

## Maintainer guide — updating course materials on S3

```powershell
npm run upload:oer
npm run serve
```

Upload credentials live in `csuf-ssp-oer/aws-updater` (not in this repo).

When you rotate the **reader** key, share the new `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` with students privately — update `api/.env`, **do not** put keys in `course-materials.config.json` or commit them.

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| `OPENAI_API_KEY is required` | Set `OPENAI_API_KEY` in `api/.env`. |
| `missing read-only AWS keys` | Set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in `api/.env`. |
| `AWSCompromisedKeyQuarantineV3` | Old key — ask team lead for new reader keys. |
| `AccessDenied` on S3 | Wrong keys or missing IAM policy — ask team lead. |
| `files: 0` | Maintainer runs `npm run upload:oer`. |
| `EADDRINUSE` | Press `Ctrl+C`, run `npm run serve` again. |
| Groq rate limit | Wait 1 minute, try a shorter question. |

---

## New machine checklist

1. Install Node.js 18+
2. `git clone` + `git pull`
3. `npm install`
4. Create **`api/.env`** with Groq + S3 reader keys (Step 3)
5. `npm run index:oer -w api` (optional check)
6. `npm run serve`
7. Open http://localhost:5173
