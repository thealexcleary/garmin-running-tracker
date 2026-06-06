# Google Sheet schema

One Sheet named `Running Tracker DB`, four tabs. Create each tab and paste its header row into
row 1 exactly (lowercase, in this order). Claude Code reads/writes by these column names.

## Tab: `Logs`  (manual session logs — one row per logged session)
| session_id | date | kind | done | distance_km | pace | rpe | notes | exercises_json | updated_at |
|---|---|---|---|---|---|---|---|---|---|

- `session_id` — `w{week}-{day}-{kind}`, e.g. `w03-2-run`, `w03-2-lift`. Primary key (upsert on this).
- `kind` — `run` or `lift`.
- `done` — `TRUE`/`FALSE`.
- `pace` — text `m:ss` per km.
- `exercises_json` — for lifts: JSON string `[{"w":"60","r":"5"}, ...]` index-aligned to the session's exercise list.
- `updated_at` — ISO timestamp.

## Tab: `Runs`  (Garmin-synced runs — one row per activity)
| activity_id | date | start_time | distance_km | duration_min | avg_pace | avg_hr | name | synced_at |
|---|---|---|---|---|---|---|---|---|

- `activity_id` — Garmin activity id. Primary key (upsert on this; dedupes re-runs).
- `date` — ISO `YYYY-MM-DD`. Frontend matches a run to a planned session by this date.

## Tab: `Parkrun`  (5k time trials)
| date | time_mmss | added_at |
|---|---|---|

- `time_mmss` — `mm:ss`, e.g. `19:45`.

## Tab: `Settings`  (single key/value rows)
| key | value |
|---|---|

- Seed rows: `last_sync` | (blank),  `garmin_last_activity_id` | (blank).
