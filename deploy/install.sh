#!/usr/bin/env bash
# BOLO HQ — idempotent installer for the VPS (Ubuntu/Debian/Oracle Linux, nginx already running).
# Run from the repo root as root:   sudo bash deploy/install.sh
# Python: the Sync API needs >= 3.9 (system python3 on the BOLO VPS is only 3.6.8).
# The installer looks for python3.11 first, then 3.12, 3.13, 3.10, 3.9, python3 — on PATH and in
# /usr/bin + /usr/local/bin (sudo's PATH may hide the latter) — and uses that SAME interpreter
# for the version check, gen-tokens and the systemd ExecStart.
# Override:   sudo BOLO_PYTHON=/usr/bin/python3.11 bash deploy/install.sh
#
# What it does (and nothing else):
#   - user `boloku`, dirs /opt/boloku (code), /var/lib/boloku (SQLite), /etc/boloku (secrets)
#   - generates /etc/boloku/sync.env with fresh tokens ONLY if it does not exist yet
#   - installs + enables systemd unit bolo-sync.service
#   - adds ONE new nginx server block for boloku.web.id, runs `nginx -t`, reloads
# It does NOT touch DNS, the panel (panel-api.boloku.web.id), chisel, or firewall rules.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PREFIX=/opt/boloku ETC=/etc/boloku DATA=/var/lib/boloku
say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run as root (sudo)"
command -v nginx   >/dev/null || die "nginx missing"

py_ok() { [[ -x "$1" ]] && "$1" -c 'import sys; sys.exit(0 if sys.version_info >= (3,9) else 1)' 2>/dev/null; }
PY="${BOLO_PYTHON:-}"
if [[ -n "$PY" ]]; then
  py_ok "$PY" || die "BOLO_PYTHON=$PY is not an executable python >= 3.9"
else
  # python3.11 first (what runs on the BOLO VPS today), then any other >= 3.9
  for c in python3.11 python3.12 python3.13 python3.10 python3.9 python3; do
    for p in "$(command -v "$c" 2>/dev/null)" ${BOLO_PY_DIRS:-/usr/bin /usr/local/bin}; do
      [[ -n "$p" && -d "$p" ]] && p="$p/$c"
      if [[ -n "$p" ]] && py_ok "$p"; then PY="$p"; break 2; fi
    done
  done
  [[ -n "$PY" ]] || die "no python >= 3.9 found (system python3 is $(python3 -V 2>&1 || echo missing)); install python3.11 or set BOLO_PYTHON=/path/to/python3.x"
fi
[[ "$PY" == /* ]] || PY="$(command -v "$PY")"
say "python for Sync API: $PY ($("$PY" -V 2>&1))"

FREE_MB=$(df -Pm / | awk 'NR==2{print $4}')
say "disk free on /: ${FREE_MB} MB (need ~5 MB)"
[[ "$FREE_MB" -gt 50 ]] || die "less than 50 MB free — free some space first"

say "user + directories"
id boloku >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin boloku
install -d -o boloku -g boloku -m 750 "$DATA"
install -d -o root -g boloku -m 750 "$ETC"
install -d -m 755 "$PREFIX"

say "copy code -> $PREFIX"
rm -rf "$PREFIX/pwa.new" "$PREFIX/server.new" "$PREFIX/reporter.new"
cp -r "$REPO/pwa" "$PREFIX/pwa.new"
mkdir -p "$PREFIX/server.new" && cp "$REPO"/server/{app.py,agents.json,gen-tokens.py} "$PREFIX/server.new/"
cp -r "$REPO/reporter" "$PREFIX/reporter.new"
for d in pwa server reporter; do rm -rf "$PREFIX/$d"; mv "$PREFIX/$d.new" "$PREFIX/$d"; done
chmod 755 "$PREFIX"/reporter/*.sh
chown -R root:root "$PREFIX"; chmod -R a+rX "$PREFIX"

if [[ ! -f "$ETC/sync.env" ]]; then
  say "generating tokens -> $ETC/sync.env (shown ONCE below, store them safely)"
  "$PY" "$PREFIX/server/gen-tokens.py" "$ETC/sync.env"
else
  say "keeping existing $ETC/sync.env (rotate: $PY $PREFIX/server/gen-tokens.py $ETC/sync.env --force)"
fi
chown root:boloku "$ETC/sync.env"; chmod 640 "$ETC/sync.env"

say "systemd unit"
# ExecStart always uses the interpreter that passed the version check above
sed "s#^ExecStart=.*#ExecStart=$PY -u /opt/boloku/server/app.py#" "$REPO/deploy/systemd/bolo-sync.service" > /etc/systemd/system/bolo-sync.service
chmod 644 /etc/systemd/system/bolo-sync.service
grep -q "^ExecStart=$PY " /etc/systemd/system/bolo-sync.service || die "failed to set ExecStart to $PY"
install -m 644 "$REPO/deploy/systemd/bolo-keepalive@.service" /etc/systemd/system/bolo-keepalive@.service
systemctl daemon-reload
systemctl enable bolo-sync.service >/dev/null
systemctl restart bolo-sync.service

say "nginx server block (new file only)"
CONF_SRC="$REPO/deploy/nginx/boloku.web.id.conf"
if [[ -d /etc/nginx/sites-available ]]; then
  install -m 644 "$CONF_SRC" /etc/nginx/sites-available/boloku.web.id
  ln -sf /etc/nginx/sites-available/boloku.web.id /etc/nginx/sites-enabled/boloku.web.id
else
  install -m 644 "$CONF_SRC" /etc/nginx/conf.d/boloku.web.id.conf
fi
nginx -t
systemctl reload nginx

say "local checks"
for i in $(seq 1 20); do curl -fsS http://127.0.0.1:8787/api/v1/health >/dev/null 2>&1 && break; sleep 0.3; done
curl -fsS http://127.0.0.1:8787/api/v1/health && echo
curl -fsS -H 'Host: boloku.web.id' http://127.0.0.1/api/v1/health >/dev/null && say "nginx -> API ok"
curl -fsS -H 'Host: boloku.web.id' http://127.0.0.1/manifest.json >/dev/null && say "nginx -> PWA ok"
say "systemctl is-enabled bolo-sync: $(systemctl is-enabled bolo-sync)"
say "ExecStart: $(grep '^ExecStart=' /etc/systemd/system/bolo-sync.service | cut -d= -f2-)"
cat <<EOF

Done. Next:
  1. Expose boloku.web.id over HTTPS following the panel's tunnel pattern — see deploy/TUNNEL.md
  2. Give each Hermes agent its token file:
       sudo bash deploy/write-agent-token.sh hunter-2 <unix-user-running-hunter-2>
  3. Run acceptance:  BOLO_AGENT=hunter-2 BOLO_TOKEN=... bash tests/acceptance.sh https://boloku.web.id
EOF
