#!/usr/bin/env bash
# Essex Cinemas' showtimes, read from this Mac (2026-10-19).
#
# Why: essexcinemas.com sits behind an AWS firewall that answers GitHub's
# runners "405 Not Allowed" on every run, while a home connection gets the
# normal page (one public page, which its robots.txt allows). So the Watch
# tab showed no Essex times at all. This reads that one page here, the way a
# browser would, and hands the screenings to the films workflow as its
# `essex` input; the workflow builds the day's showtimes with them. Nothing
# tries to get past the firewall, and the other two theaters still come from
# GitHub. A morning the Mac is off, the workflow keeps Essex's times still
# ahead from the last good read.
#
#   bash scripts/send_essex_showtimes.sh run       read Essex now and start the workflow
#   bash scripts/send_essex_showtimes.sh install   do that every morning at 6:15 (a launchd job; only while the Mac is awake)
#   bash scripts/send_essex_showtimes.sh check     is the job loaded, and the last few showtimes runs
#   bash scripts/send_essex_showtimes.sh remove    stop and delete the job
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
REPO="btownbrief/btown-brief"
GH="$(command -v gh || echo /opt/homebrew/bin/gh)"
LABEL="com.btownbrief.essex-showtimes"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

case "${1:-check}" in
  run)
    json="$(python3 "$HERE/scripts/build_showtimes.py" --essex-dump)" || { echo "Could not read Essex's page from here either."; exit 1; }
    "$GH" workflow run refresh-films.yml -R "$REPO" -f what=showtimes -f essex="$json"
    echo "Sent Essex's screenings; the showtimes run has started on GitHub."
    ;;
  install)
    mkdir -p "$(dirname "$PLIST")"
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>/bin/bash</string><string>-lc</string>
    <string>/bin/bash "$HERE/scripts/send_essex_showtimes.sh" run >>/tmp/essex-showtimes.log 2>&1</string>
  </array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>15</integer></dict>
  <key>RunAtLoad</key><false/>
</dict></plist>
PLIST
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "Installed: Essex's times are read every morning at 6:15 while this Mac is awake (log: /tmp/essex-showtimes.log)."
    ;;
  check)
    if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then echo "$LABEL: loaded"; else echo "$LABEL: not loaded"; fi
    "$GH" run list -R "$REPO" --workflow refresh-films.yml --limit 4 --json createdAt,event,conclusion \
      --jq '.[] | "  \(.createdAt) \(.event) \(.conclusion)"' 2>/dev/null || echo "  (gh not signed in)"
    ;;
  remove)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "$LABEL: removed"
    ;;
  *)
    echo "usage: bash scripts/send_essex_showtimes.sh [run|install|check|remove]"
    exit 2
    ;;
esac
