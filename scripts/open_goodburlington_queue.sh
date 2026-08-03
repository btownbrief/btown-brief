#!/bin/sh
# GoodBurlington queue — daily open, meant to run from launchd on Stephen's
# Mac (infrastructure/com.btownbrief.goodburlington-queue.plist). Opens the
# tap-to-post queue page in the browser once a day, and only when there is
# actually something queued — an empty queue never interrupts him.
set -eu
DATA="https://guide.btownbrief.com/data/goodburlington-queue.json"
PAGE="https://guide.btownbrief.com/goodburlington-queue.html"
count=$(curl -fsS --max-time 20 "$DATA" \
  | /usr/bin/python3 -c 'import json,sys; print(len(json.load(sys.stdin).get("items") or []))' \
  2>/dev/null || echo 0)
if [ "${count:-0}" -gt 0 ]; then
  echo "$(date '+%F %T') opening queue ($count items)"
  open "$PAGE"
else
  echo "$(date '+%F %T') queue empty; staying quiet"
fi
