#!/usr/bin/env bash
# Run a command while keeping the agent "working" on the dashboard.
# Sends a heartbeat every $BOLO_INTERVAL seconds (default 20) so it never times out (60s),
# then reports idle on success or idle+error detail on failure.
#
#   with-status.sh <agent_id> "<task>" -- <command> [args...]
#
# Example (Hermes cron):
#   with-status.sh hunter-2 "Scan airdrop baru" -- python3 scan.py
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT="${1:?agent_id}"; TASK="${2:?task}"; shift 2
[[ "${1:-}" == "--" ]] && shift
[[ $# -gt 0 ]] || { echo "missing command after --" >&2; exit 2; }
INTERVAL="${BOLO_INTERVAL:-20}"
export BOLO_QUIET=1

"$DIR/report-status.sh" "$AGENT" working "$TASK" || true
( while sleep "$INTERVAL"; do "$DIR/report-status.sh" "$AGENT" working "$TASK" >/dev/null 2>&1 || true; done ) &
BEAT=$!
trap 'kill $BEAT 2>/dev/null; "$DIR/report-status.sh" "$AGENT" idle "Dihentikan: $TASK" >/dev/null 2>&1; exit 130' INT TERM

"$@"; RC=$?
kill $BEAT 2>/dev/null; wait $BEAT 2>/dev/null
if [[ $RC -eq 0 ]]; then
  "$DIR/report-status.sh" "$AGENT" idle "Selesai: $TASK" || true
else
  "$DIR/report-status.sh" "$AGENT" idle "Gagal: $TASK" "exit code $RC" || true
fi
exit $RC
