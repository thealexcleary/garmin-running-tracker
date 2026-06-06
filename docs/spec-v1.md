# Garmin Running Tracker — Spec v1

## 1. What is this thing?

A zero-cost personal training tracker. A mobile web app displays Alex's static 28-week
run + lift plan (June–December 2026) and lets him log every session. Each night, a Python
script pulls his completed runs from Garmin Connect and writes them into a Google Sheet, so
run distances and paces fill in automatically — he only manually logs lifts and notes. The
Google Sheet is the database; a Google Apps Script web app is the API; GitHub Actions runs
the nightly Garmin sync. Everything runs on free tiers.

**Input:** Alex's Garmin activities + his manual taps in the app.
**Output:** a single live log of planned vs actual training, viewable on his phone, backed by a Sheet he can open directly.

## 2. Hard guardrails (non-negotiable)

- **$0 forever.** No paid hosting, no Google Cloud billing, no subscriptions. If a step would cost money, stop and ask.
- **No secrets in the repo.** Garmin login, API tokens, GitHub PAT live only in GitHub Secrets and Apps Script Script Properties.
- **The 28-week plan is single-sourced in `frontend/index.html`.** Never duplicate it into Python or the Sheet.
- **The Sheet stores only dynamic data:** manual logs, synced runs, parkrun times, settings.
- **Garmin sync must fail safe.** If Garmin login fails, log it and email Alex — never crash silently, never wipe existing data.
- **Never delete a user's manual entry.** Garmin sync only fills empty run fields or adds new run rows; it must not overwrite a note or RPE Alex typed.
- **One run per day max** in this plan — matching a Garmin run to a session is by date only.

## 3. Architecture & data flow

```
frontend/index.html  ──fetch GET/POST──▶  apps-script/Code.gs (Web App URL)
                                                │
                                                ▼  reads/writes
                                        Google Sheet  [Logs] [Runs] [Parkrun] [Settings]
                                                ▲
                                                │ HTTP POST (token-authed)
.github/workflows/nightly-sync.yml ──runs──▶ garmin-sync/sync.py ──garminconnect──▶ Garmin Connect
        (cron + workflow_dispatch)
```

- **Read path:** app `GET`s the Apps Script URL → returns `{logs, runs, parkrun, settings}` JSON → app merges with the local plan and renders.
- **Write path (manual):** app `POST`s a log/parkrun entry → Apps Script upserts a Sheet row.
- **Sync path (nightly):** GitHub Action runs `sync.py` → logs into Garmin → for each recent run, `POST`s it to the Apps Script URL → Apps Script upserts into `Runs`.
- **"Sync now":** app `POST`s `{type:"sync"}` → Apps Script calls the GitHub API (`workflow_dispatch`) using a PAT in Script Properties → the Action runs immediately.

### Folder structure
```
garmin-running-tracker/
├── CLAUDE.md
├── README.md                 ← human setup guide (manual steps)
├── .env.example              ← names of all secrets/config
├── docs/
│   ├── spec-v1.md            ← this file
│   └── garmin-notes.md       ← garminconnect gotchas
├── sheet/
│   └── schema.md             ← exact tab + column layout to create
├── apps-script/
│   ├── CLAUDE.md
│   ├── Code.gs               ← the API (doGet/doPost/sync trigger)
│   └── appsscript.json
├── garmin-sync/
│   ├── CLAUDE.md
│   ├── sync.py               ← Garmin puller → POSTs to Apps Script
│   └── requirements.txt
├── .github/
│   └── workflows/
│       └── nightly-sync.yml
└── frontend/
    ├── CLAUDE.md
    └── index.html            ← phone app (adapt from existing training-app.html)
```

## 4. The Google Sheet (database)

One Google Sheet, four tabs. Exact columns in `sheet/schema.md`. Summary:

- **Logs** — manual session logs. One row per logged session. Key = `session_id`.
  Columns: `session_id, date, kind, done, distance_km, pace, rpe, notes, exercises_json, updated_at`
- **Runs** — Garmin-synced runs. One row per Garmin activity. Key = `activity_id`.
  Columns: `activity_id, date, start_time, distance_km, duration_min, avg_pace, avg_hr, name, synced_at`
- **Parkrun** — 5k time-trial log. Columns: `date, time_mmss, added_at`
- **Settings** — single-row key/values. Columns: `key, value` (e.g. `last_sync`, `garmin_last_activity_id`).

The frontend matches a `Runs` row to a planned run session by `date` (the plan is local, so the
frontend already knows which day has a run). `exercises_json` holds the per-exercise weight×reps
array for lift sessions, stored as a JSON string.

## 5. Components — step by step

### 5a. Apps Script API (`apps-script/Code.gs`)
- **Trigger:** HTTP requests from the frontend and from `sync.py`.
- **`doGet(e)`** → returns JSON `{logs:[...], runs:[...], parkrun:[...], settings:{...}}` read from the four tabs.
- **`doPost(e)`** → body is JSON `{token, type, payload}`:
  - `type:"log"` → upsert a row in **Logs** keyed by `payload.session_id` (update if exists, else append). Merge fields — do NOT blank fields the payload omits.
  - `type:"run"` → upsert a row in **Runs** keyed by `payload.activity_id` (used by `sync.py`).
  - `type:"parkrun"` → append a row in **Parkrun**.
  - `type:"sync"` → call GitHub `POST /repos/{owner}/{repo}/actions/workflows/nightly-sync.yml/dispatches` with PAT from Script Properties; return `{ok:true}`.
- **Auth:** every POST must include `token` matching `API_TOKEN` in Script Properties, else 403.
- **Error handling:** wrap in try/catch, return `{ok:false, error:...}` with a 200 (Apps Script can't easily set status codes); never throw uncaught.
- **Secrets (Script Properties):** `API_TOKEN`, `GITHUB_PAT`, `GITHUB_REPO` (e.g. `alexcleary/garmin-running-tracker`).

Reference shape (Claude Code to implement fully, test each handler):
```javascript
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.token !== props('API_TOKEN')) return json({ok:false, error:'unauthorized'});
    if (body.type === 'log')      return json(upsertLog(body.payload));
    if (body.type === 'run')      return json(upsertRun(body.payload));
    if (body.type === 'parkrun')  return json(appendParkrun(body.payload));
    if (body.type === 'sync')     return json(triggerSync());
    return json({ok:false, error:'unknown type'});
  } catch (err) { return json({ok:false, error:String(err)}); }
}
```

### 5b. Garmin sync (`garmin-sync/sync.py`)
- **Trigger:** GitHub Actions (nightly cron + manual `workflow_dispatch`).
- **Inputs (env):** `GARMIN_EMAIL`, `GARMIN_PASSWORD`, `APPS_SCRIPT_URL`, `API_TOKEN`.
- **Process:**
  1. Log into Garmin Connect via `garminconnect` (cache the token/session if possible).
  2. Fetch activities from the last **3 days** (small overlap is fine — upsert dedupes).
  3. Filter to running activity types (`running`, `trail_running`, `treadmill_running`).
  4. For each: build payload `{activity_id, date, start_time, distance_km, duration_min, avg_pace, avg_hr, name}`.
  5. `POST` each to `APPS_SCRIPT_URL` as `{token, type:"run", payload}`.
  6. Update `Settings.last_sync`.
- **Output:** rows in the Sheet's **Runs** tab. Print a one-line summary per run.
- **Error handling:** on Garmin login failure, print clearly and exit non-zero so the Action emails on failure. Never raise without a message.

Reference shape:
```python
from garminconnect import Garmin
g = Garmin(os.environ['GARMIN_EMAIL'], os.environ['GARMIN_PASSWORD'])
g.login()
acts = g.get_activities_by_date(start, end)  # exact method name: verify in garmin-notes.md
for a in acts:
    if 'running' in a['activityType']['typeKey']:
        post_run(map_activity(a))
```

### 5c. GitHub Action (`.github/workflows/nightly-sync.yml`)
- `on: schedule: cron '0 19 * * *'` (19:00 UTC ≈ 05:00 AEST) **and** `workflow_dispatch`.
- Steps: checkout → setup Python 3.11 → `pip install -r garmin-sync/requirements.txt` → `python garmin-sync/sync.py`.
- Secrets mapped to env: `GARMIN_EMAIL`, `GARMIN_PASSWORD`, `APPS_SCRIPT_URL`, `API_TOKEN`.
- On failure, GitHub emails the repo owner by default — keep that on.

### 5d. Frontend (`frontend/index.html`)
- Start from the existing `training-app.html` (already built — same plan, UI, tabs).
- Replace the localStorage read/write with `fetch` to the Apps Script URL:
  - On load: `GET` → populate logs/runs/parkrun.
  - On edit/mark-done: `POST {type:"log", ...}`.
  - Parkrun add: `POST {type:"parkrun", ...}`.
  - "Sync now" button (add to Progress tab): `POST {type:"sync"}` then re-fetch after a delay.
- **Run sessions auto-fill** from the `Runs` data matched by date; show a "🟢 from Garmin" badge. Manual fields (RPE, notes) stay editable and are saved to Logs.
- Keep a localStorage cache as offline fallback; reconcile on next successful GET.
- Config block at top: `const API_URL = "..."; const API_TOKEN = "...";`

## 6. External services
- **Garmin Connect** — auth: email+password via unofficial `garminconnect` lib. No official key. Risks: login changes, MFA, rate limits. See `docs/garmin-notes.md`.
- **Google Apps Script Web App** — auth: deploy "execute as me / anyone with the link"; protect writes with `API_TOKEN`. The URL itself is a secret.
- **GitHub API** — `workflow_dispatch` needs a fine-grained PAT with `actions:write` on this repo only. Stored in Apps Script Script Properties.

## 7. Open questions / decisions to confirm during build
- Confirm exact `garminconnect` method names + response keys against the installed version (pin the version in requirements.txt).
- Choose frontend host: GitHub Pages (same repo, free) vs tiny.host. Either is fine.
- parkrun runs are also Garmin activities — decide whether to auto-detect 5k TTs or keep manual. Default: manual for now.

## 8. Build order (one step, test, commit, next)
1. **[MANUAL]** Create the Google Sheet + 4 tabs with headers from `sheet/schema.md`.
2. **[MANUAL]** Open Extensions → Apps Script; paste `Code.gs` + `appsscript.json`; set Script Properties.
3. Implement & test `doGet` — visit the Web App URL, confirm JSON of empty tabs.
4. Implement & test `doPost` `type:"log"` — curl a log, confirm a row appears in **Logs**.
5. Wire `frontend/index.html` to the API — log a lift on the phone, confirm it lands in the Sheet.
6. `sync.py` step 1 — log into Garmin, print last 3 days of runs (no writing). Test locally.
7. `sync.py` step 2 — POST runs to Apps Script; confirm a real run appears in **Runs** and shows in the app with the Garmin badge.
8. **[MANUAL]** Create GitHub repo, push, add Secrets, enable Actions.
9. GitHub Action — run via `workflow_dispatch`; confirm it syncs end-to-end.
10. "Sync now" button — frontend → Apps Script → dispatch → Action → Sheet. Test the loop.
11. Harden — dedupe, login-failure email, don't-overwrite-manual-fields, offline cache.

Each step = one Claude Code prompt. Don't start the next until the current one is verified.

## 9. Success criteria
- Opening the app on the phone shows this week with today expanded, data loaded from the Sheet.
- Logging a lift on the phone writes a row to **Logs** within ~2s and survives a refresh on another device.
- After a real Garmin run, the next nightly Action (or "Sync now") makes that run appear in the app with distance + pace pre-filled and a "from Garmin" badge — no manual entry.
- A wrong Garmin password makes the Action fail and emails Alex; it does not corrupt the Sheet.
- Total monthly cost: **$0**.
