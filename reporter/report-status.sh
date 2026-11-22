#!/usr/bin/env bash
# Report one heartbeat to the BOLO Sync API.
#
#   report-status.sh <agent_id> <working|idle|offline> "<task>" ["detail"] [progress 0-100]
#
# Token lookup (first match wins, never pass it as an argument):
#   $BOLO_TOKEN  ->  ~/.config/boloku/<agent_id>.token  ->  /etc/boloku/agents/<agent_id>.token
# API base: $BOLO_API (default https://boloku.web.id/api/v1)
set -euo pipefail

if [[ $# -lt 2 ]]; then
  sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi

AGENT="$1"; STATUS="$2"; TASK="${3:-}"; DETAIL="${4:-}"; PROGRESS="${5:-}"
API="${BOLO_API:-https://boloku.web.id/api/v1}"

case "$STATUS" in working|idle|offline) ;; *) echo "status must be working|idle|offline" >&2; exit 2;; esac

TOKEN="${BOLO_TOKEN:-}"
for f in "$HOME/.config/boloku/$AGENT.token" "/etc/boloku/agents/$AGENT.token"; do
  [[ -z "$TOKEN" && -r "$f" ]] && TOKEN="$(tr -d '[:space:]' < "$f")"
done
[[ -z "$TOKEN" ]] && { echo "no token for $AGENT (set BOLO_TOKEN or ~/.config/boloku/$AGENT.token)" >&2; exit 3; }

json_str() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"; }
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
BODY="{\"agent_id\":$(json_str "$AGENT"),\"status\":\"$STATUS\",\"task\":$(json_str "$TASK"),\"detail\":$(json_str "$DETAIL"),\"ts\":\"$TS\""
[[ -n "$PROGRESS" ]] && BODY="$BODY,\"progress\":$PROGRESS"
BODY="$BODY}"

# token goes via a header file on stdin-like fd so it never shows in `ps`
HTTP=$(curl -sS -o /tmp/.bolo-hb.$$ -w '%{http_code}' --max-time 10 \
  -H @<(printf 'Authorization: Bearer %s\n' "$TOKEN") \
  -H 'Content-Type: application/json' \
  --data-binary "$BODY" "$API/heartbeat") || { echo "network error" >&2; rm -f /tmp/.bolo-hb.$$; exit 4; }
OUT="$(cat /tmp/.bolo-hb.$$)"; rm -f /tmp/.bolo-hb.$$
if [[ "$HTTP" != "200" ]]; then echo "HTTP $HTTP: $OUT" >&2; exit 5; fi
[[ -n "${BOLO_QUIET:-}" ]] || echo "ok $AGENT $STATUS ${TASK:+— $TASK}"
