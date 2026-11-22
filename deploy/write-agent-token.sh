#!/usr/bin/env bash
# Copy one agent's token from /etc/boloku/sync.env into that agent's own token file
# (~<user>/.config/boloku/<agent_id>.token, mode 600). Token is never printed.
#   sudo bash deploy/write-agent-token.sh <agent_id> <unix_user>
set -euo pipefail
AGENT="${1:?agent_id}"; USER_="${2:?unix user}"
[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }
LINE=$(grep '^BOLO_TOKENS=' /etc/boloku/sync.env | cut -d= -f2-)
TOK=$(printf '%s' "$LINE" | tr ',' '\n' | awk -F: -v a="$AGENT" '$1==a{print substr($0, length(a)+2)}')
[[ -n "$TOK" ]] || { echo "no token for $AGENT in sync.env" >&2; exit 1; }
HOME_=$(getent passwd "$USER_" | cut -d: -f6)
[[ -n "$HOME_" ]] || { echo "unknown user $USER_" >&2; exit 1; }
install -d -o "$USER_" -m 700 "$HOME_/.config/boloku"
umask 077
printf '%s\n' "$TOK" > "$HOME_/.config/boloku/$AGENT.token"
chown "$USER_" "$HOME_/.config/boloku/$AGENT.token"; chmod 600 "$HOME_/.config/boloku/$AGENT.token"
echo "wrote $HOME_/.config/boloku/$AGENT.token (600, owner $USER_)"
