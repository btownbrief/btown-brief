#!/bin/sh
# Burlington Pulse — cadence insurance.
#
# GitHub sheds scheduled workflow ticks under load (observed 2026-08-09:
# 3 of 13 ten-minute slots honored, ~40-minute effective gaps), while
# workflow_dispatch events fire immediately and reliably. This pings the
# refresh workflow every 10 minutes from launchd on Stephen's Mac using
# the already-authenticated gh CLI — no tokens stored anywhere.
#
# Duplicate fires are free: the workflow's concurrency group serializes
# runs, and a run that finds nothing new publishes only a check receipt.
# When the Mac is asleep, GitHub's own (shed-prone) schedule still runs —
# the two cover for each other.
#
# Remove with:
#   launchctl bootout "gui/$(id -u)/com.btownbrief.pulse-dispatch"
#   rm ~/Library/LaunchAgents/com.btownbrief.pulse-dispatch.plist
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
command -v gh >/dev/null 2>&1 || exit 0
gh workflow run refresh-pulse.yml -R btownbrief/btown-brief >>/tmp/pulse-dispatch.log 2>&1
