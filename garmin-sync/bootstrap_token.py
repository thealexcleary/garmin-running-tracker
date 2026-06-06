"""
Garmin Running Tracker — ONE-TIME local token bootstrap.

Garmin's login (mobile-SSO via garminconnect 0.3.x) needs your email, password, and a 2FA
code. You can't do an interactive 2FA prompt inside GitHub Actions, so do it ONCE here:
this logs in, proves it can read your activities, then prints a base64 token blob.

Run it locally:
    cd garmin-sync
    python3 -m venv .venv && . .venv/bin/activate
    pip install -r requirements.txt
    python bootstrap_token.py

Then copy the printed blob into a GitHub Secret named GARMIN_TOKENS_B64 (see README / docs).
The token (DI OAuth) auto-refreshes for ~1 year, so the nightly Action never needs your
password or 2FA again. Re-run this if the Action ever starts failing with an auth error.

NOTHING here is committed — the blob is a secret. Do not paste it into the repo.
"""
import base64
import datetime
import getpass
import sys

try:
    from garminconnect import Garmin
except ImportError:
    sys.exit("garminconnect not installed — run: pip install -r requirements.txt")

RUN_TYPES = {"running", "trail_running", "treadmill_running"}


def main():
    email = input("Garmin email: ").strip()
    password = getpass.getpass("Garmin password (hidden): ")

    # prompt_mfa is called by login() only if Garmin asks for a 2FA code.
    g = Garmin(email, password, prompt_mfa=lambda: input("Garmin 2FA code: ").strip())

    print("\nLogging in…", flush=True)
    g.login()
    print("✅ Login OK.")

    # Prove the token actually works by reading the last few days of activities.
    end = datetime.date.today()
    start = end - datetime.timedelta(days=7)
    acts = g.get_activities_by_date(start.isoformat(), end.isoformat())
    runs = [a for a in acts if a.get("activityType", {}).get("typeKey", "") in RUN_TYPES]
    print(f"Found {len(acts)} activities in the last 7 days, {len(runs)} of them runs:")
    for a in runs[:5]:
        print(f"  - {a.get('startTimeLocal', '?')[:10]}  {a.get('activityName', 'Run')}  "
              f"{round((a.get('distance') or 0) / 1000, 2)} km")

    # Serialize the session tokens and base64 them for safe single-line storage.
    blob = base64.b64encode(g.client.dumps().encode()).decode()
    with open("garmin_token_b64.txt", "w") as f:
        f.write(blob)

    print("\n" + "=" * 70)
    print("GARMIN_TOKENS_B64 (copy ALL of this into the GitHub Secret):")
    print("=" * 70)
    print(blob)
    print("=" * 70)
    print("Also saved to garmin-sync/garmin_token_b64.txt (gitignored — do NOT commit).")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        sys.exit(f"\n❌ Bootstrap failed: {e}")
