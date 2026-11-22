#!/usr/bin/env bash
# Keep an always-on agent visible as "idle" (heartbeat every 30s) — for Hermes agents
# that run continuously on the VPS. Pair with a systemd unit: deploy/systemd/bolo-keepalive@.service
#
#   keepalive.sh <agent_id>
#
# It reads the current task from ~/.config/boloku/<agent_id>.state if present
# (format: "<status>|<task>"), so an agent can just write that file instead of calling curl.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT="${1:?agent_id}"
STATE="${BOLO_STATE_FILE:-$HOME/.config/boloku/$AGENT.state}"
export BOLO_QUIET=1
trap '"$DIR/report-status.sh" "$AGENT" offline "" >/dev/null 2>&1; exit 0' INT TERM
while true; do
  STATUS=idle; TASK=""
  if [[ -r "$STATE" ]]; then IFS='|' read -r STATUS TASK < "$STATE" || true; fi
  case "$STATUS" in working|idle|offline) ;; *) STATUS=idle;; esac
  "$DIR/report-status.sh" "$AGENT" "$STATUS" "$TASK" >/dev/null 2>&1 || echo "$(date -Is) heartbeat failed" >&2
  sleep "${BOLO_INTERVAL:-30}" & wait $!
done
