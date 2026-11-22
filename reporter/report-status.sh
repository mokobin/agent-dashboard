#!/usr/bin/env bash
# Report one agent's status to the Sync API.
# Usage:
#   SYNC_API_URL=http://127.0.0.1:8001 AGENT_TOKEN=<token> \
#     ./reporter/report-status.sh hunter-2 working "Audit QNAP battery run 4"
# status: working | idle | offline
set -euo pipefail

API_URL="${SYNC_API_URL:-http://127.0.0.1:8001}"
AGENT_ID="${1:?usage: report-status.sh <agent_id> <status> <task...>}"
STATUS="${2:?usage: report-status.sh <agent_id> <status> <task...>}"
shift 2
TASK="$*"
TOKEN="${AGENT_TOKEN:-}"

BODY=$(python3 -c 'import json,sys;from datetime import datetime,timezone;print(json.dumps({"agent_id":sys.argv[1],"status":sys.argv[2],"task":sys.argv[3],"ts":datetime.now(timezone.utc).isoformat()}))' "$AGENT_ID" "$STATUS" "$TASK")

curl -s -X POST "$API_URL/api/v1/heartbeat" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "$BODY"
echo
