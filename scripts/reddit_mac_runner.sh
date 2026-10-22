#!/usr/bin/env bash
# Reddit, read from this Mac (2026-10-22).
#
# Why: Reddit blocks GitHub's runners, ends RSS on Nov 13 (Inoreader's copies
# die with it) and is closing its API early. Logged-out reddit.com still
# answers a home connection. Every 30 minutes while the Mac is awake this
# reads the subreddit listings the site needs (scripts/reddit_mac_runner.py:
# logged out, a few pages a run, 4+ seconds apart, backing off on 403/429)
# and force-pushes the results as one commit to the `reddit-data` branch,
# the same branch and pattern refresh-reddit.yml uses:
#   data/reddit-intake.json    r/burlington, r/vermont + the Pulse's national subs
#   data/reddit-listings.json  the copy GitHub's jobs read (On Air, Changes,
#                              r/GoodBurlington strip and queue)
#   data/reddit-report.json/.md the route comparison
# GitHub's own run steps aside while this is fresh (90 minutes) and takes
# over, without wiping anything, when the Mac sleeps.
#
# Quiet on success: the last run's summary goes to
# ~/Library/Application Support/btownbrief/reddit-runner/last-run.txt and the
# log (~/Library/Logs/btownbrief/reddit-runner.log) only gets failures.
#
#   bash scripts/reddit_mac_runner.sh run       read Reddit now and push
#   bash scripts/reddit_mac_runner.sh install   do that every 30 minutes (a launchd job), from a
#                                               detached worktree of origin/main at ~/btownbrief/reddit-runner
#   bash scripts/reddit_mac_runner.sh check     is the job loaded, the last run, the branch's age
#   bash scripts/reddit_mac_runner.sh remove    stop and delete the job
#
# REDDIT_DATA_BRANCH=<name> pushes somewhere else (a test branch); a branch
# that doesn't exist yet starts from reddit-data's files.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
REPO="btownbrief/btown-brief"
REPO_URL="https://github.com/$REPO.git"
BRANCH="${REDDIT_DATA_BRANCH:-reddit-data}"
SEED_BRANCH="reddit-data"
LABEL="com.btownbrief.reddit-runner"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
STATE_DIR="$HOME/Library/Application Support/btownbrief/reddit-runner"
LOG="$HOME/Library/Logs/btownbrief/reddit-runner.log"
MAIN_CHECKOUT="$HOME/btownbrief/btown-brief"
RUNNER_DIR="$HOME/btownbrief/reddit-runner"
GH="$(command -v gh || echo /opt/homebrew/bin/gh)"

log() {
  mkdir -p "$(dirname "$LOG")"
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"
}

case "${1:-check}" in
  run)
    mkdir -p "$STATE_DIR"
    LOCK="$STATE_DIR/lock"
    if ! mkdir "$LOCK" 2>/dev/null; then
      # a run that died hard leaves its lock; 20 minutes is far past any real run
      if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +20 2>/dev/null)" ]; then
        rm -rf "$LOCK"; mkdir "$LOCK"
      else
        exit 0
      fi
    fi
    WORK="$(mktemp -d)"
    trap 'rm -rf "$WORK" "$LOCK"' EXIT
    mkdir -p "$WORK/prev/data" "$WORK/out"
    git init -q "$WORK/git"

    # The branch's current files. If it exists but can't be fetched, stop:
    # restarting the rolling store from nothing would wipe it.
    PREV_SHA=""
    set +e
    git ls-remote --exit-code --heads "$REPO_URL" "$BRANCH" >/dev/null 2>&1
    HAS=$?
    set -e
    if [ "$HAS" = 0 ]; then
      git -C "$WORK/git" fetch -q --depth 1 "$REPO_URL" "$BRANCH" \
        || { log "FAILED: couldn't fetch $BRANCH; nothing pushed"; exit 1; }
      PREV_SHA="$(git -C "$WORK/git" rev-parse FETCH_HEAD)"
    elif [ "$HAS" = 2 ]; then
      # a new (test) branch starts from the live branch's files
      if [ "$BRANCH" != "$SEED_BRANCH" ]; then
        git -C "$WORK/git" fetch -q --depth 1 "$REPO_URL" "$SEED_BRANCH" 2>/dev/null || true
      fi
    else
      log "FAILED: couldn't reach GitHub to read $BRANCH; nothing pushed"
      exit 1
    fi
    if git -C "$WORK/git" rev-parse -q --verify FETCH_HEAD >/dev/null 2>&1; then
      for f in reddit-intake.json reddit-listings.json; do
        git -C "$WORK/git" show "FETCH_HEAD:data/$f" > "$WORK/prev/data/$f" 2>/dev/null || rm -f "$WORK/prev/data/$f"
      done
    fi

    set +e
    python3 "$HERE/scripts/reddit_mac_runner.py" --prev "$WORK/prev" --out "$WORK/out" \
      --state "$STATE_DIR/state.json" > "$WORK/run.txt" 2>&1
    CODE=$?
    set -e
    { date '+%Y-%m-%d %H:%M:%S'; echo "branch: $BRANCH  exit: $CODE"; cat "$WORK/run.txt"; } > "$STATE_DIR/last-run.txt"
    if [ "$CODE" = 3 ]; then
      log "NOTHING READ (branch left as it was): $(head -c 600 "$WORK/run.txt" | tr '\n' ' ')"
      exit 0
    elif [ "$CODE" != 0 ]; then
      log "FAILED (exit $CODE, nothing pushed): $(tail -c 1200 "$WORK/run.txt" | tr '\n' ' ')"
      exit 1
    fi
    if grep -q "FAILED" "$WORK/run.txt"; then
      log "PARTIAL (pushed the rest): $(grep "FAILED" "$WORK/run.txt" | head -c 600 | tr '\n' ' ')"
    fi

    cd "$WORK/out"
    git init -q -b "$BRANCH"
    git add data/reddit-intake.json data/reddit-listings.json data/reddit-report.json data/reddit-report.md
    git -c user.name="btown-brief-bot (Mac)" -c user.email="actions@users.noreply.github.com" \
      commit -q -m "Reddit intake $(date -u +%FT%TZ) (Stephen's Mac)"
    # The lease refuses the push if GitHub's run (or another Mac run) moved
    # the branch since we read it; the next run starts from that instead.
    git push -q --force-with-lease="refs/heads/$BRANCH:$PREV_SHA" "$REPO_URL" "HEAD:refs/heads/$BRANCH" 2>"$WORK/push.txt" \
      || { log "FAILED: push to $BRANCH refused or failed: $(tr '\n' ' ' < "$WORK/push.txt" | head -c 300)"; exit 1; }
    ;;
  install)
    # Like essex-runner: the job runs from a detached worktree, so branch
    # switches in the main checkout never change what it runs. Re-running
    # install moves it to the latest origin/main.
    git -C "$MAIN_CHECKOUT" fetch -q origin main
    if [ -d "$RUNNER_DIR" ]; then
      git -C "$RUNNER_DIR" checkout -q --detach origin/main
    else
      git -C "$MAIN_CHECKOUT" worktree add -q --detach "$RUNNER_DIR" origin/main
    fi
    if [ ! -f "$RUNNER_DIR/scripts/reddit_mac_runner.sh" ]; then
      echo "origin/main doesn't have the Reddit runner yet; merge its pull request first."
      exit 1
    fi
    mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>/bin/bash</string><string>-lc</string>
    <string>/bin/bash "$RUNNER_DIR/scripts/reddit_mac_runner.sh" run</string>
  </array>
  <!-- Every 30 minutes while the Mac is awake; a sleep is caught up once on wake. -->
  <key>StartInterval</key><integer>1800</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
PLIST
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "Installed: Reddit is read every 30 minutes while this Mac is awake (failures: $LOG)."
    ;;
  check)
    if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then echo "$LABEL: loaded"; else echo "$LABEL: not loaded"; fi
    if [ -f "$STATE_DIR/last-run.txt" ]; then sed 's/^/  /' "$STATE_DIR/last-run.txt" | head -20; else echo "  (no run yet)"; fi
    "$GH" api "repos/$REPO/branches/$BRANCH" --jq '"  \(.name) last pushed \(.commit.commit.committer.date): \(.commit.commit.message)"' 2>/dev/null \
      || echo "  (couldn't read the $BRANCH branch)"
    [ -f "$LOG" ] && { echo "  recent problems:"; tail -5 "$LOG" | sed 's/^/    /'; } || true
    ;;
  remove)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "$LABEL: removed"
    ;;
  *)
    echo "usage: bash scripts/reddit_mac_runner.sh [run|install|check|remove]"
    exit 2
    ;;
esac
