"""
Garmin Running Tracker — nightly Garmin sync.
Pulls recent runs from Garmin Connect, POSTs them to the Apps Script API -> Sheet 'Runs' tab.
See ../docs/spec-v1.md §5b and ../docs/garmin-notes.md.

Auth: resumes from a saved DI-OAuth token (no password / no 2FA in CI). Generate the token
once with bootstrap_token.py and store it base64 in the GARMIN_TOKENS_B64 env/secret.
"""
import base64
import datetime
import json
import os
import sys
import urllib.request

from garminconnect import Garmin

APPS_SCRIPT_URL = os.environ["APPS_SCRIPT_URL"]
API_TOKEN = os.environ["API_TOKEN"]
RUN_TYPES = {"running", "trail_running", "treadmill_running"}
LOOKBACK_DAYS = 3


def garmin_login():
    """Resume a Garmin session from the saved token. On any failure, print + exit non-zero
    so the GitHub Action is marked failed and emails the owner (never write garbage)."""
    blob = os.environ.get("GARMIN_TOKENS_B64")
    if not blob:
        print("ERROR: GARMIN_TOKENS_B64 is not set. Run bootstrap_token.py locally and store "
              "the printed blob as that secret.", file=sys.stderr)
        sys.exit(1)
    try:
        tokenstore = base64.b64decode(blob).decode()   # the dumps() JSON string
        g = Garmin()                                    # no creds needed to resume
        g.login(tokenstore)                             # >512 chars -> loaded as token data
        return g
    except Exception as e:
        print(f"ERROR: Garmin login/token-resume failed: {e}\n"
              f"The token may have expired or been revoked — re-run bootstrap_token.py and "
              f"update GARMIN_TOKENS_B64.", file=sys.stderr)
        sys.exit(1)


def fetch_runs(g):
    """Return mapped run payloads from the last LOOKBACK_DAYS days."""
    end = datetime.date.today()
    start = end - datetime.timedelta(days=LOOKBACK_DAYS)
    try:
        acts = g.get_activities_by_date(start.isoformat(), end.isoformat())
    except Exception as e:
        print(f"ERROR: fetching activities failed: {e}", file=sys.stderr)
        sys.exit(1)
    runs = [a for a in acts if a.get("activityType", {}).get("typeKey", "") in RUN_TYPES]
    return [map_activity(a) for a in runs]


def fmt_pace(pace_min_per_km):
    """Float minutes/km -> 'm:ss', carrying 60s up to the next minute (avoids '7:60')."""
    if not pace_min_per_km:
        return ""
    mins = int(pace_min_per_km)
    secs = int(round((pace_min_per_km - mins) * 60))
    if secs == 60:
        mins += 1
        secs = 0
    return f"{mins}:{secs:02d}"


def map_activity(a):
    """Garmin activity dict -> Sheet 'Runs' payload."""
    speed = a.get("averageSpeed") or 0  # m/s
    pace = (1000 / speed) / 60 if speed else 0  # min/km
    return {
        "activity_id": str(a["activityId"]),
        "date": a["startTimeLocal"][:10],
        "start_time": a["startTimeLocal"],
        "distance_km": round((a.get("distance") or 0) / 1000, 2),
        "duration_min": round((a.get("duration") or 0) / 60, 1),
        "avg_pace": fmt_pace(pace),
        "avg_hr": a.get("averageHR") or "",
        "name": a.get("activityName") or "Run",
    }


def post_run(payload):
    # text/plain keeps Apps Script happy; e.postData.contents still gets the raw JSON.
    body = json.dumps({"token": API_TOKEN, "type": "run", "payload": payload}).encode()
    req = urllib.request.Request(APPS_SCRIPT_URL, data=body,
                                 headers={"Content-Type": "text/plain"})
    with urllib.request.urlopen(req, timeout=30) as r:
        text = r.read().decode()
    try:
        res = json.loads(text)
    except ValueError:
        res = {}
    # Don't claim success on a rejected write (e.g. bad token) — fail so the Action emails.
    if res.get("ok") is False:
        raise RuntimeError(f"API rejected run {payload['activity_id']}: {res.get('error')}")
    return res


def main():
    g = garmin_login()
    runs = fetch_runs(g)
    if not runs:
        print(f"No new runs in the last {LOOKBACK_DAYS} days.")
        return
    for run in runs:
        post_run(run)
        print(f"Synced {run['date']} {run['name']} — {run['distance_km']} km @ {run['avg_pace']}/km")
    print(f"Done. {len(runs)} run(s) synced.")


if __name__ == "__main__":
    main()
