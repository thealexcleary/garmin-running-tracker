# Garmin Connect — integration notes & gotchas

There is **no official, free, personal Garmin API**. The official Garmin Connect Developer
Program / Health API is for approved companies and uses OAuth. For a single-user personal tool,
the practical route is the unofficial **`garminconnect`** Python library, which logs in with your
email + password and uses Garmin's internal endpoints.

## Library  (verified against garminconnect 0.3.5, June 2026)
- PyPI: `garminconnect`. **`garth` is dead** — its mobile-auth broke March 2026 and it's
  deprecated. 0.3.x logs in via Garmin's mobile-SSO flow (deps: `curl_cffi`, `ua-generator`).
  The old `0.2.25` pin no longer logs in. Pin `0.3.5`; bump only after re-verifying login works.
- **Auth = saved DI-OAuth token, not password-in-CI.** `client.dumps()` returns a JSON string of
  `{di_token, di_refresh_token, di_client_id}`; the DI token auto-refreshes (~1yr). We capture it
  once locally (handling 2FA) and store it base64 as the `GARMIN_TOKENS_B64` secret. No
  `actions/cache` needed — the token is self-contained and passed straight in.

## Verified API (0.3.5)
- Constructor: `Garmin(email=None, password=None, is_cn=False, prompt_mfa=<callable>, ...)`.
  `prompt_mfa` is invoked only if 2FA is required (interactive bootstrap uses `input`).
- Login: `login(tokenstore: str | None = None) -> (needs_mfa, None)`. `tokenstore` may be a
  **directory path OR the raw token string** — if `len > 512` it's loaded as token data
  (`client.loads`). So CI just calls `Garmin().login(<decoded blob>)`, no password.
- Token save/restore: `client.dumps()/dump(path)`, `client.loads(str)/load(path)`.
- Activities by date: `get_activities_by_date(startdate, enddate, activitytype=None, sortorder=None)`.
- Activity fields used: `activityId`, `startTimeLocal`, `distance` (metres), `duration` (seconds),
  `averageSpeed` (m/s), `averageHR`, `activityName`, `activityType.typeKey`.
- Pace from speed: `pace_min_per_km = (1000 / averageSpeed) / 60`. Format as `m:ss`.

## Known risks / gotchas
- **Login can break** when Garmin changes their auth flow — pin the version, be ready to bump,
  and re-run `bootstrap_token.py` if the Action starts failing with an auth error.
- **2FA stays ON** on this account (Alex's choice) — handled by the one-time local bootstrap;
  the nightly Action never needs the password or a 2FA code.
- **Token expiry / revocation** (~1yr, or on password change) → the Action fails and emails the
  owner; fix is re-running the bootstrap and updating the secret. Never writes partial rows.
- **Rate limits:** don't poll aggressively. Nightly + occasional manual is fine.
- **Region:** use `Garmin(..., is_cn=False)`. Garmin.com (not .cn).
- **Distances are metres, durations seconds** — convert. Treadmill runs may have GPS-less distance; still valid.

## Failure handling (required)
- Wrap login in try/except. On failure: print a clear message and `sys.exit(1)` so the GitHub
  Action is marked failed and emails the owner. Do NOT write partial/garbage rows.
- Sync is idempotent: always upsert by `activity_id`, so re-running after a fix causes no duplicates.
