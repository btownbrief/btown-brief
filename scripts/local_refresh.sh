#!/bin/sh
# Burlington Pulse — local refresh, meant to run from launchd on one of
# Stephen's Macs. Reddit's RSS works from residential IPs (no key, no
# registration), which GitHub Actions can't reach; this fills that gap.
#
# Uses a dedicated clone (~/btownbrief/.pulse-runner) so it can never
# fight with whatever branch the working checkout has open.
set -eu
RUNNER="$HOME/btownbrief/.pulse-runner"
REPO="https://github.com/btownbrief/btown-brief.git"
if [ ! -d "$RUNNER/.git" ]; then
  git clone -q "$REPO" "$RUNNER"
fi
cd "$RUNNER"
git checkout -q main
git pull -q --rebase origin main
python3 scripts/refresh_chatter.py
git add data/chatter.json data/chatter-seen.json
if git diff --cached --quiet; then
  exit 0
fi
git -c user.name="btown-brief-bot" -c user.email="actions@users.noreply.github.com" \
  commit -q -m "Auto-refresh Burlington Pulse data (local RSS)"
git push -q origin main || { git pull -q --rebase origin main && git push -q origin main; }
