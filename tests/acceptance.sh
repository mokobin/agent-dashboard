#!/usr/bin/env bash
# Acceptance test for BOLO HQ.
#   BOLO_AGENT=hunter-2 BOLO_TOKEN=<token> bash tests/acceptance.sh https://boloku.web.id
# Optional: BOLO_OFFLINE_AFTER (default 60), SKIP_OFFLINE=1 to skip the 65s wait.
set -uo pipefail
BASE="${1:-https://boloku.web.id}"; BASE="${BASE%/}"; API="$BASE/api/v1"
AGENT="${BOLO_AGENT:?set BOLO_AGENT}"; : "${BOLO_TOKEN:?set BOLO_TOKEN}"
OFF="${BOLO_OFFLINE_AFTER:-60}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0; FAIL=0
ok()   { printf '  \033[32mPASS\033[0m %s\n' "$*"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$*"; FAIL=$((FAIL+1)); }
skip() { printf '  \033[33mSKIP\033[0m %s\n' "$*"; }
hdr()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"; kill ${SSE:-} 2>/dev/null' EXIT

hdr "1. PWA dapat dibuka & installable"
code=$(curl -sS -o "$TMP/index" -w '%{http_code}' "$BASE/") ; [[ $code == 200 ]] && grep -q 'rel="manifest"' "$TMP/index" && ok "GET / 200 + <link rel=manifest>" || bad "GET / -> $code"
curl -sS "$BASE/manifest.json" -o "$TMP/m.json"
python3 - "$TMP/m.json" <<'EOF' && ok "manifest valid (name, start_url, display, ikon 192+512)" || bad "manifest invalid"
import json,sys; m=json.load(open(sys.argv[1]))
assert m["name"] and m["start_url"] and m["display"] in ("standalone","fullscreen","minimal-ui")
s={i["sizes"] for i in m["icons"]}; assert "192x192" in s and "512x512" in s
EOF
code=$(curl -sS -o "$TMP/sw" -w '%{http_code}' "$BASE/sw.js"); [[ $code == 200 ]] && grep -q 'addEventListener("fetch"' "$TMP/sw" && ok "sw.js 200 + fetch handler" || bad "sw.js -> $code"
[[ "$BASE" == https://* ]] && ok "HTTPS (syarat install PWA)" || skip "bukan HTTPS ($BASE) — install PWA butuh HTTPS"

hdr "2. Heartbeat -> SSE dalam hitungan detik"
curl -sSN --max-time 30 "$API/events" > "$TMP/sse" 2>/dev/null & SSE=$!
sleep 1.5
MARK="Acceptance $(date +%H%M%S)"
t0=$(date +%s.%N)
code=$(curl -sS -o "$TMP/hb" -w '%{http_code}' -H "Authorization: Bearer $BOLO_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"agent_id\":\"$AGENT\",\"status\":\"working\",\"task\":\"$MARK\"}" "$API/heartbeat")
[[ $code == 200 ]] && ok "POST heartbeat 200" || bad "POST heartbeat -> $code $(cat "$TMP/hb")"
got=""
for i in $(seq 1 50); do grep -q "$MARK" "$TMP/sse" && { got=1; break; }; sleep 0.1; done
t1=$(date +%s.%N)
[[ -n $got ]] && ok "SSE menerima perubahan dalam $(python3 -c "print(round($t1-$t0,2))") dtk" || bad "SSE tidak menerima event dalam 5 dtk (cek buffering proxy)"
kill $SSE 2>/dev/null
curl -sS "$API/status" | python3 -c "
import json,sys; a=[x for x in json.load(sys.stdin)['agents'] if x['agent_id']=='$AGENT'][0]
assert a['online'] and a['status']=='working' and a['task']=='$MARK', a" && ok "GET /status: $AGENT online + working" || bad "status tidak sesuai"
code=$(curl -sS -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer salah' -H 'Content-Type: application/json' \
  -d "{\"agent_id\":\"$AGENT\",\"status\":\"idle\"}" "$API/heartbeat"); [[ $code == 401 ]] && ok "token salah ditolak (401)" || bad "token salah -> $code"

hdr "3. Matikan heartbeat -> offline setelah ${OFF} dtk"
if [[ -n "${SKIP_OFFLINE:-}" ]]; then skip "SKIP_OFFLINE di-set"; else
  echo "  menunggu $((OFF+6)) dtk…"; sleep $((OFF+6))
  curl -sS "$API/status" | python3 -c "
import json,sys; a=[x for x in json.load(sys.stdin)['agents'] if x['agent_id']=='$AGENT'][0]
assert (not a['online']) and a['status']=='offline' and a['last_seen'], a
print('  last_seen', a['last_seen'])" && ok "$AGENT offline + last_seen terisi" || bad "$AGENT belum offline"
fi

hdr "4. Server-side (hanya bila dijalankan di VPS)"
if command -v systemctl >/dev/null && systemctl list-unit-files bolo-sync.service >/dev/null 2>&1 && systemctl cat bolo-sync >/dev/null 2>&1; then
  [[ $(systemctl is-enabled bolo-sync) == enabled ]] && ok "bolo-sync enabled (hidup lagi setelah reboot)" || bad "bolo-sync tidak enabled"
  [[ $(systemctl is-active bolo-sync) == active ]] && ok "bolo-sync active" || bad "bolo-sync tidak active"
  if command -v nginx >/dev/null; then nginx -t >/dev/null 2>&1 && ok "nginx -t lolos" || bad "nginx -t gagal (jalankan dengan sudo?)"; fi
else skip "bukan di VPS — cek manual: systemctl is-enabled bolo-sync; sudo nginx -t"; fi

hdr "5. Tidak ada secret di repo"
if git -C "$DIR" rev-parse >/dev/null 2>&1; then
  if git -C "$DIR" grep -nF -- "$BOLO_TOKEN" >/dev/null 2>&1; then bad "TOKEN DITEMUKAN DI REPO"; else ok "token tidak ada di file yang dilacak git"; fi
  if git -C "$DIR" ls-files | grep -Eq '(^|/)(\.env|sync\.env|.*\.token)$'; then bad "file secret ter-commit"; else ok "tidak ada .env/.token ter-commit"; fi
else skip "bukan git checkout"; fi

printf '\n\033[1mHasil: %d PASS, %d FAIL\033[0m\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]]
