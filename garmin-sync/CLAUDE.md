# Garmin Sync

Python script that pulls recent runs from Garmin Connect and POSTs them to the Apps Script API,
which writes them into the Sheet's `Runs` tab. Run by GitHub Actions (nightly + manual).

## Inputs (env)
`GARMIN_TOKENS_B64`, `APPS_SCRIPT_URL`, `API_TOKEN`. (No password in CI — auth is a saved token.)

## Auth (token-resume, 2FA stays on)
- `bootstrap_token.py` is run ONCE locally: logs in with email+password+2FA, then prints a
  base64 token blob. Store that as the GitHub Secret `GARMIN_TOKENS_B64`.
- `sync.py` base64-decodes it and calls `Garmin().login(<blob>)` — no password, no 2FA prompt.
  The DI token auto-refreshes (~1yr). Re-run the bootstrap if the Action fails with an auth error.

## What it does
1. Resume Garmin session from `GARMIN_TOKENS_B64` (fail-safe: print + `sys.exit(1)` on failure).
2. Fetch activities from the last 3 days (`get_activities_by_date`).
3. Keep running types only (`running`, `trail_running`, `treadmill_running`).
4. Map each to `{activity_id, date, start_time, distance_km, duration_min, avg_pace, avg_hr, name}`.
5. POST each as `{token, type:"run", payload}` to `APPS_SCRIPT_URL` (Content-Type: text/plain).

## Rules
- **Fail safe:** on login/fetch failure, print clearly and `sys.exit(1)` so the Action emails the owner.
- **Idempotent:** upsert by `activity_id` — re-runs never duplicate.
- Distances are metres, durations seconds — convert. Pace from `averageSpeed` (m/s): `(1000/speed)/60`.
- Verify method names/fields against the installed version — see ../docs/garmin-notes.md.
- Pin the `garminconnect` version in requirements.txt (currently `0.3.5`; `garth`/0.2.x is dead).

## Test
- One-time: `python bootstrap_token.py` → enter creds + 2FA → confirms it reads your runs.
- Then: `export GARMIN_TOKENS_B64=... APPS_SCRIPT_URL=... API_TOKEN=...; python sync.py`
  → prints runs, rows appear in the Sheet's Runs tab.
