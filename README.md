# Garmin Running Tracker — Setup

A $0 training tracker: mobile web app + Google Sheet database + nightly Garmin sync.
Full design is in `docs/spec-v1.md`. Hand that to Claude Code to build. This README is the
**manual setup** — the bits a human has to click through. Do these as Claude Code reaches them
in the build order.

## What you'll need (all free)
- A Google account (for the Sheet + Apps Script).
- A GitHub account (for the nightly sync + hosting).
- Your Garmin Connect email + password.

## One-time setup steps

### 1. Create the Google Sheet (the database)
1. Make a new Google Sheet, name it `Running Tracker DB`.
2. Create four tabs named exactly: `Logs`, `Runs`, `Parkrun`, `Settings`.
3. Add the header row to each tab exactly as listed in `sheet/schema.md`.

### 2. Deploy the Apps Script API
1. In the Sheet: **Extensions → Apps Script**.
2. Paste in `apps-script/Code.gs` and set `apps-script/appsscript.json`.
3. **Project Settings → Script Properties**, add:
   - `API_TOKEN` — make up a long random string (this protects writes).
   - `GITHUB_PAT` — a GitHub fine-grained token with `actions:write` on this repo only.
   - `GITHUB_REPO` — e.g. `yourname/garmin-running-tracker`.
4. **Deploy → New deployment → Web app**: execute as **Me**, access **Anyone with the link**.
5. Copy the **Web App URL** — you'll paste it into the frontend and GitHub Secrets.

### 3. Set up the GitHub repo + nightly sync
1. Create a GitHub repo, push this project to it.
2. **Settings → Secrets and variables → Actions → New repository secret**, add:
   - `GARMIN_EMAIL`, `GARMIN_PASSWORD`
   - `APPS_SCRIPT_URL` (the Web App URL from step 2.5)
   - `API_TOKEN` (same value as in Script Properties)
3. **Actions tab → enable workflows.** Run `nightly-sync` manually once to test.

### 4. Configure + host the app
1. In `frontend/index.html`, set `API_URL` (the Web App URL) and `API_TOKEN`.
2. Host it free: **GitHub Pages** (Settings → Pages → deploy from `frontend/`) or upload to **tiny.host**.
3. Open the page on your phone → **Add to Home Screen**.

## Daily use
- Log lifts + notes in the app; runs fill in automatically after the nightly sync.
- Hit **Sync now** in the Progress tab to pull a run immediately.
- Anything looks off? Open the Google Sheet directly — it's the source of truth, you can edit it by hand.

## If Garmin sync breaks
The `garminconnect` library is unofficial and occasionally breaks when Garmin changes their login.
GitHub will email you when the Action fails. See `docs/garmin-notes.md` for the fix-it checklist.
Your manual logs are unaffected — only auto-run-fill pauses.
