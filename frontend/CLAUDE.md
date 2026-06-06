# Frontend (phone app)

Single-file vanilla HTML/CSS/JS. No framework, no build step. Hosted free on GitHub Pages or tiny.host.

## Starting point
`index.html` is the existing training app (the 28-week plan + UI is already built and tested).
The job is to swap its **localStorage** persistence for **API calls** to the Apps Script Web App.
**Do not rebuild the plan or the UI** — only change the data layer.

## Config (top of the script)
```js
const API_URL   = "https://script.google.com/macros/s/XXXX/exec";
const API_TOKEN = "same-long-random-string-as-script-properties";
```

## Data layer changes
- **On load:** `GET API_URL` → `{logs, runs, parkrun, settings}`. Populate state from `logs`/`parkrun`.
- **Run auto-fill:** for each plan day that has a run, look up `runs` by that day's date. If found,
  pre-fill distance + pace and show a `🟢 from Garmin` badge. Manual fields (RPE/notes) stay editable.
- **On edit / mark-done:** debounce, then `POST {token, type:"log", payload:{session_id, ...}}`.
- **Parkrun add:** `POST {token, type:"parkrun", payload:{date, time_mmss}}`.
- **Add a "Sync now" button** (Progress tab): `POST {token, type:"sync"}`, then re-`GET` after ~20s.
- **Offline fallback:** keep writing to localStorage as a cache; reconcile on the next successful GET
  (server wins for runs, local-unsynced-edits win for manual fields).

## Rules
- Keep it one file, no external JS deps.
- Never put `API_TOKEN` anywhere but this file (it's a personal single-user tool; acceptable here).
- Don't block the UI on network — render from cache first, then refresh when the GET returns.

## Test
- Log a lift on the phone → row in Sheet `Logs` → reload on a second device shows it.
- After a synced run exists in `Runs`, that day shows distance/pace + the Garmin badge automatically.
