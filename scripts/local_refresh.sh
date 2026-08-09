#!/bin/sh
# RETIRED (Aug 2026). This used to refresh the old chatter-based Burlington
# Pulse from a residential IP because Reddit's RSS blocks GitHub Actions.
# The rebuilt Pulse (pulse.html + scripts/refresh_pulse.py) reads everything
# through Inoreader's servers instead, so Actions covers it end to end and
# no local runner is needed.
#
# The launchd job that calls this (com.btownbrief.pulse-local, 4x daily) can
# be removed whenever convenient:
#   launchctl bootout "gui/$(id -u)/com.btownbrief.pulse-local"
#   rm ~/Library/LaunchAgents/com.btownbrief.pulse-local.plist
# Until then, this stub keeps it quiet.
exit 0
