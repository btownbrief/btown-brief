#!/usr/bin/env python3
"""One-time helper: mint the REDDIT_REFRESH_TOKEN for the crossposter.

Run locally, logged into reddit as u/whiteshirtdude1 in the default browser:

    REDDIT_CLIENT_ID=... REDDIT_CLIENT_SECRET=... python3 scripts/goodburlington_token.py

The reddit app must list http://localhost:8777/callback as its redirect URI
(edit at https://www.reddit.com/prefs/apps). The script opens the authorize
page, catches the redirect, exchanges the code, verifies the account really
is u/whiteshirtdude1, and prints the refresh token plus the `gh secret set`
command to store it. Nothing is written to disk.
"""

import base64
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
import secrets
import sys
import urllib.parse
import urllib.request
import webbrowser

PORT = 8777
REDIRECT = f"http://localhost:{PORT}/callback"
UA = "btown-brief-site/1.0 (goodburlington token helper)"
EXPECTED_USER = "whiteshirtdude1"


def main():
    cid = os.environ.get("REDDIT_CLIENT_ID", "").strip()
    secret = os.environ.get("REDDIT_CLIENT_SECRET", "").strip()
    if not cid or not secret:
        print("set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET first", file=sys.stderr)
        return 1

    state = secrets.token_urlsafe(16)
    url = "https://www.reddit.com/api/v1/authorize?" + urllib.parse.urlencode({
        "client_id": cid, "response_type": "code", "state": state,
        "redirect_uri": REDIRECT, "duration": "permanent", "scope": "identity read submit"})
    print("Opening browser — approve as u/" + EXPECTED_USER)
    print("If it doesn't open, visit:\n" + url)
    webbrowser.open(url)

    captured = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            captured["code"] = (query.get("code") or [None])[0]
            captured["state"] = (query.get("state") or [None])[0]
            captured["error"] = (query.get("error") or [None])[0]
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"Done - you can close this tab and return to the terminal.")

        def log_message(self, *args):
            pass

    server = HTTPServer(("localhost", PORT), Handler)
    server.handle_request()

    if captured.get("error") or not captured.get("code"):
        print(f"authorization failed: {captured.get('error') or 'no code returned'}", file=sys.stderr)
        return 1
    if captured.get("state") != state:
        print("state mismatch — aborting (possible CSRF)", file=sys.stderr)
        return 1

    basic = base64.b64encode(f"{cid}:{secret}".encode()).decode()
    body = urllib.parse.urlencode({"grant_type": "authorization_code",
                                   "code": captured["code"], "redirect_uri": REDIRECT}).encode()
    request = urllib.request.Request("https://www.reddit.com/api/v1/access_token", data=body,
                                     headers={"User-Agent": UA, "Authorization": "Basic " + basic})
    with urllib.request.urlopen(request, timeout=30) as response:
        tokens = json.loads(response.read())
    refresh = tokens.get("refresh_token")
    access = tokens.get("access_token")
    if not refresh or not access:
        print(f"token exchange returned no refresh token: {tokens}", file=sys.stderr)
        return 1

    me = urllib.request.Request("https://oauth.reddit.com/api/v1/me",
                                headers={"User-Agent": UA, "Authorization": "Bearer " + access})
    with urllib.request.urlopen(me, timeout=30) as response:
        name = (json.loads(response.read()).get("name") or "").strip()
    if name.lower() != EXPECTED_USER:
        print(f"logged-in account is u/{name}, not u/{EXPECTED_USER} — token NOT usable, "
              "log into the right account and rerun", file=sys.stderr)
        return 1

    print(f"\nVerified account: u/{name}")
    print("Store the secret with:\n")
    print(f"  gh secret set REDDIT_REFRESH_TOKEN --repo btownbrief/btown-brief --body '{refresh}'\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
