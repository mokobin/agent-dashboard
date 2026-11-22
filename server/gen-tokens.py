#!/usr/bin/env python3
"""
Generate per-agent tokens + admin token into an env file (chmod 600).

  python3 gen-tokens.py /etc/boloku/sync.env           # create (refuses to overwrite)
  python3 gen-tokens.py /etc/boloku/sync.env --force   # rotate ALL tokens

Tokens are printed ONCE so you can hand each agent its own token.
Never commit the output file.
"""
import json
import os
import secrets
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    path = sys.argv[1]
    force = "--force" in sys.argv
    if os.path.exists(path) and not force:
        print(f"{path} already exists — use --force to rotate all tokens.", file=sys.stderr)
        sys.exit(1)
    with open(os.path.join(HERE, "agents.json"), encoding="utf-8") as f:
        agents = [a["agent_id"] for a in json.load(f)["agents"]]
    toks = {a: secrets.token_urlsafe(32) for a in agents}
    admin = secrets.token_urlsafe(32)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    old = os.umask(0o077)
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write("# BOLO Sync API secrets — DO NOT COMMIT\n")
            f.write("BOLO_TOKENS=" + ",".join(f"{a}:{t}" for a, t in toks.items()) + "\n")
            f.write(f"BOLO_ADMIN_TOKEN={admin}\n")
            f.write("BOLO_HOST=127.0.0.1\nBOLO_PORT=8787\nBOLO_DB=/var/lib/boloku/state.db\nBOLO_OFFLINE_AFTER=60\n")
    finally:
        os.umask(old)
    os.chmod(path, 0o600)
    print(f"Wrote {path} (mode 600). Hand out these tokens privately:\n")
    for a, t in toks.items():
        print(f"  {a:14s} {t}")
    print(f"\n  ADMIN (PWA Pusat Perintah) {admin}")


if __name__ == "__main__":
    main()
