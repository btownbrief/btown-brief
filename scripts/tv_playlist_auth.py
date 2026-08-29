#!/usr/bin/env python3
"""BTown TV — one-time OAuth setup for the "BTown TV — Tonight" playlist.

curate_tv.py rewrites a public YouTube playlist every edition so the page
plays on the TV app with one click. Writing to a playlist needs OAuth as the
channel owner (an API key can only read). This script runs ONCE, on your
laptop, and prints the four values to paste into the repo's Actions secrets.

Before running, make an OAuth client in Google Cloud (same project as the
YouTube API key):
  1. console.cloud.google.com -> APIs & Services -> Credentials
  2. "+ Create credentials" -> "OAuth client ID" -> Application type
     "Desktop app" -> name it "btown-tv" -> Create
  3. If it asks you to configure the consent screen first: External,
     app name "BTown TV", your email, add yourself under Test users, save.
     (Test-user mode is fine — only your account ever signs in.)
  4. Copy the Client ID and Client secret.

Then:
  python3 scripts/tv_playlist_auth.py --client-id ... --client-secret ...

A browser opens; sign in with the BTown Brief YouTube account; the script
catches the redirect on localhost, trades the code for a refresh token,
creates the playlist, and prints:

  YT_OAUTH_CLIENT_ID, YT_OAUTH_CLIENT_SECRET, YT_OAUTH_REFRESH_TOKEN,
  YT_TV_PLAYLIST_ID

Add those four as repository secrets (Settings -> Secrets and variables ->
Actions). Nothing is written to disk by this script.

Note: while the OAuth app is in "Testing" mode Google expires refresh tokens
after 7 days. Either publish the app (no verification needed for a
youtube.force-ssl scope used only by its owner — click "Publish app" on the
consent screen) or re-run this script when the playlist stops updating.
"""

import argparse
import http.server
import json
import secrets
import sys
import threading
import urllib.parse
import urllib.request
import webbrowser

SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl"
AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN = "https://oauth2.googleapis.com/token"
API = "https://www.googleapis.com/youtube/v3"
PORT = 8765


class Catcher(http.server.BaseHTTPRequestHandler):
    code = None
    state = None
    got = threading.Event()

    def do_GET(self):  # noqa: N802 — http.server API
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        if query.get("state", [""])[0] != Catcher.state:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b"state mismatch")
            return
        Catcher.code = query.get("code", [""])[0]
        Catcher.got.set()
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(b"<h2>BTown TV is connected. You can close this tab.</h2>")

    def log_message(self, *args):  # quiet
        pass


def post_json(url, form=None, json_body=None, token=None):
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
    else:
        data = json.dumps(json_body).encode()
        headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--client-id", required=True)
    parser.add_argument("--client-secret", required=True)
    parser.add_argument("--title", default="BTown TV — Tonight")
    parser.add_argument("--playlist-id", default="",
                        help="reuse an existing playlist instead of creating one")
    args = parser.parse_args()

    Catcher.state = secrets.token_urlsafe(16)
    redirect = f"http://localhost:{PORT}/"
    server = http.server.HTTPServer(("localhost", PORT), Catcher)
    threading.Thread(target=server.handle_request, daemon=True).start()

    url = AUTH + "?" + urllib.parse.urlencode({
        "client_id": args.client_id, "redirect_uri": redirect,
        "response_type": "code", "scope": SCOPE, "access_type": "offline",
        "prompt": "consent", "state": Catcher.state})
    print("Opening the browser for Google sign-in…")
    if not webbrowser.open(url):
        print("Open this URL yourself:\n" + url)
    Catcher.got.wait(timeout=600)
    if not Catcher.code:
        print("no code received within 10 minutes — try again", file=sys.stderr)
        sys.exit(1)

    tokens = post_json(TOKEN, form={
        "code": Catcher.code, "client_id": args.client_id,
        "client_secret": args.client_secret, "redirect_uri": redirect,
        "grant_type": "authorization_code"})
    refresh = tokens.get("refresh_token")
    access = tokens.get("access_token")
    if not refresh:
        print("Google did not return a refresh token — remove the app under "
              "myaccount.google.com/permissions and run again", file=sys.stderr)
        sys.exit(1)

    playlist_id = args.playlist_id
    if not playlist_id:
        created = post_json(f"{API}/playlists?part=snippet,status", token=access,
                            json_body={
                                "snippet": {
                                    "title": args.title,
                                    "description": ("Tonight's BTown TV edition — one "
                                                    "curated page of videos for "
                                                    "Burlington, rewritten daily. "
                                                    "guide.btownbrief.com/all-day/")},
                                "status": {"privacyStatus": "public"}})
        playlist_id = created["id"]
        print(f"Created playlist {playlist_id}")

    print("\nAdd these four repository secrets "
          "(Settings -> Secrets and variables -> Actions):\n")
    print(f"YT_OAUTH_CLIENT_ID={args.client_id}")
    print(f"YT_OAUTH_CLIENT_SECRET={args.client_secret}")
    print(f"YT_OAUTH_REFRESH_TOKEN={refresh}")
    print(f"YT_TV_PLAYLIST_ID={playlist_id}")
    print(f"\nPlaylist: https://www.youtube.com/playlist?list={playlist_id}")


if __name__ == "__main__":
    main()
