# Apps Script API

The free, Google-hosted API the phone app talks to. Reads/writes the four Sheet tabs.
Lives in the Sheet's Apps Script editor (Extensions → Apps Script), not run from this repo —
this folder is the source of truth, paste it in and deploy.

## Endpoints
- `doGet(e)` → `{logs, runs, parkrun, settings}` from the four tabs.
- `doPost(e)` with JSON `{token, type, payload}`:
  - `type:"log"` → upsert **Logs** by `payload.session_id`. **Merge** — never blank a field the payload omits.
  - `type:"run"` → upsert **Runs** by `payload.activity_id` (called by sync.py).
  - `type:"parkrun"` → append **Parkrun**.
  - `type:"sync"` → GitHub `workflow_dispatch` using `GITHUB_PAT`/`GITHUB_REPO`.

## Rules
- Every POST must match `API_TOKEN` (Script Property) or return `{ok:false, error:'unauthorized'}`.
- Wrap everything in try/catch; always return JSON via `ContentService` (`MimeType.JSON`).
- Secrets come from `PropertiesService.getScriptProperties()` — never hard-code.
- Upserts: find row by key column, update in place if found, else append. Read headers from row 1, don't assume column order.

## Test
- `doGet`: open the Web App URL in a browser → see JSON of empty arrays.
- `doPost`: `curl -X POST -d '{"token":"...","type":"log","payload":{...}}' <url>` → row appears in Logs.
