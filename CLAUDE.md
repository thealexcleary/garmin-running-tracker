# Garmin Running Tracker

A zero-cost training logger for Alex Cleary's 2026 race season. A mobile web app shows a
28-week run + lift plan and lets him log sessions. Garmin runs are pulled in automatically
each night so distances/paces fill themselves in. Nothing costs money to run.

## How it fits together (read this first)

```
 Phone web app  ──HTTP──▶  Apps Script Web App  ──read/write──▶  Google Sheet (the database)
 (frontend/)               (apps-script/)                         tabs: Logs, Runs, Parkrun, Settings
       ▲                          ▲                                        ▲
       │                          │ "Sync now" triggers workflow           │ writes runs
       │                          ▼                                        │
       └──────────────  GitHub Actions (nightly cron) ──▶ garmin-sync/sync.py (Python, garminconnect)
```

- The **28-week plan is static** and lives in the frontend JS. It is NOT in the Sheet.
- The **Sheet only stores dynamic data**: manual logs, Garmin-synced runs, parkrun times.
- Frontend merges plan (local) + logs/runs (from Sheet) at render time.

## Tech stack (chosen for $0 cost, no servers)
- **Database:** Google Sheet (4 tabs). Free, human-readable, editable by hand.
- **API:** Google Apps Script Web App (JavaScript / `.gs`). Free, Google-hosted.
- **Garmin sync:** Python 3.11 + `garminconnect` library, run by **GitHub Actions** (free cron).
- **Frontend:** single-file vanilla HTML/CSS/JS (no framework, no build step). Hosted on GitHub Pages or tiny.host.
- **Secrets:** GitHub Actions Secrets + Apps Script Script Properties. Never in code.

## Folder structure
- `frontend/` — the phone app (`index.html`). Talks to the Apps Script API.
- `apps-script/` — `Code.gs` API + `appsscript.json`. Pasted into the Sheet's Apps Script editor.
- `garmin-sync/` — `sync.py` Garmin puller + `requirements.txt`.
- `.github/workflows/` — `nightly-sync.yml` schedules and runs the sync.
- `sheet/` — `schema.md`, the exact tab/column layout to create in the Google Sheet.
- `docs/` — `spec-v1.md` (full spec, READ IT FIRST) and `garmin-notes.md` (library gotchas).

## Conventions
- Times/dates in AEST (Australia/Melbourne). Dates stored as ISO `YYYY-MM-DD` strings.
- `session_id` format is `w{weekIdx}-{dayIdx}-{kind}` e.g. `w03-2-run` (matches the frontend plan).
- Garmin runs match a planned session **by date only** (max one run per day in this plan).
- All money/cost decisions default to the free option. If something would cost money, STOP and ask.
- No secrets in committed files. Use `.env.example` as the template; real values go in GitHub Secrets / Script Properties.

## Build order (do one step, test, then next — full detail in docs/spec-v1.md)
1. Create the Google Sheet + tabs (manual, see `sheet/schema.md`).
2. Apps Script API: `doGet` returns all data; test in browser.
3. Apps Script API: `doPost` upserts a log; test with curl.
4. Wire frontend to the API (swap localStorage for fetch); test logging end-to-end.
5. `sync.py`: log into Garmin, print recent runs (no writing yet); test locally.
6. `sync.py`: POST runs to Apps Script; test one real run appears in the Sheet + app.
7. GitHub Action: schedule + manual trigger; test `workflow_dispatch`.
8. "Sync now" button: frontend → Apps Script → GitHub dispatch; test the full loop.
9. Hardening: failure email, dedupe, error logging.

## Important rules
- **Read `docs/spec-v1.md` completely before writing any code.** Summarise it back before starting.
- The `garminconnect` library is **unofficial** and can break when Garmin changes login. Handle login failure gracefully and email on failure. See `docs/garmin-notes.md`.
- Do NOT duplicate the 28-week plan into Python or the Sheet. Plan is single-sourced in `frontend/index.html`.
- Keep everything within free tiers. No paid hosting, no Google Cloud billing.
- Manual setup steps (Sheet creation, Apps Script deploy, GitHub Secrets) are the user's job — flag them clearly, don't try to automate them.
