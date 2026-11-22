#!/usr/bin/env python3
"""Sync API for the Agent Dashboard PWA (boloku.web.id).

Stdlib-only, no dependencies. Run:  python3 server/sync_api.py
Env:
  SYNC_API_HOST   (default 127.0.0.1)
  SYNC_API_PORT   (default 8001)
  SYNC_DATA_FILE  (default server/data/status.json, relative to repo root)
  AGENT_TOKENS    comma list "agent_id:token" — if unset, DEV mode
                  (any heartbeat accepted, warning logged).

Endpoints:
  POST /api/v1/heartbeat   (Bearer token per agent)
  GET  /api/v1/status      (snapshot; stale > 60s => online false)
  GET  /api/v1/events      (SSE stream)
  GET  /health
"""

import json
import os
import queue
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

KNOWN_AGENTS = {
    "bolo_airdrop": "hermes",
    "bolongonten": "hermes",
    "hunter-2": "hermes",
    "mas-wowo": "muse",
    "mas-wiwi": "muse",
}
STALE_SECONDS = 60

HOST = os.environ.get("SYNC_API_HOST", "127.0.0.1")
PORT = int(os.environ.get("SYNC_API_PORT", "8001"))
DATA_FILE = os.environ.get(
    "SYNC_DATA_FILE",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "status.json"),
)

TOKENS = {}
for pair in os.environ.get("AGENT_TOKENS", "").split(","):
    if ":" in pair:
        agent_id, token = pair.split(":", 1)
        TOKENS[agent_id.strip()] = token.strip()
if not TOKENS:
    print("WARNING: AGENT_TOKENS unset — DEV mode, any heartbeat accepted.", flush=True)

_lock = threading.Lock()
_subscribers: list[queue.Queue] = []
_state: dict[str, dict] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load() -> None:
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            for agent_id, rec in data.items():
                if agent_id in KNOWN_AGENTS:
                    _state[agent_id] = rec
        except (OSError, ValueError) as exc:
            print(f"WARNING: could not load {DATA_FILE}: {exc}", flush=True)
    for agent_id, platform in KNOWN_AGENTS.items():
        _state.setdefault(agent_id, {
            "agent_id": agent_id, "platform": platform, "status": "offline",
            "task": "", "detail": "", "last_seen": None,
        })


def _save() -> None:
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(_state, f, indent=2)
    os.replace(tmp, DATA_FILE)


def _snapshot() -> dict:
    now = datetime.now(timezone.utc)
    agents = []
    for agent_id in KNOWN_AGENTS:
        rec = dict(_state[agent_id])
        last = rec.get("last_seen")
        online = False
        if last:
            try:
                online = (now - datetime.fromisoformat(last)).total_seconds() <= STALE_SECONDS
            except ValueError:
                online = False
        rec["online"] = online
        agents.append(rec)
    return {"agents": agents, "generated_at": _now_iso()}


def _broadcast(payload: dict) -> None:
    for q in list(_subscribers):
        q.put(payload)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # keep stdout clean; systemd gets the rest
        print(f"{self.address_string()} {fmt % args}", flush=True)

    def _json(self, code: int, obj: dict) -> None:
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"ok": True})
        elif self.path == "/api/v1/status":
            with _lock:
                self._json(200, _snapshot())
        elif self.path == "/api/v1/events":
            self._sse()
        else:
            self._json(404, {"error": "not found"})

    def _sse(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        q: queue.Queue = queue.Queue()
        with _lock:
            _subscribers.append(q)
            self.wfile.write(f"data: {json.dumps(_snapshot())}\n\n".encode("utf-8"))
            self.wfile.flush()
        try:
            while True:
                try:
                    payload = q.get(timeout=20)
                    self.wfile.write(f"data: {json.dumps(payload)}\n\n".encode("utf-8"))
                except queue.Empty:
                    self.wfile.write(b": keepalive\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            with _lock:
                if q in _subscribers:
                    _subscribers.remove(q)

    def do_POST(self):
        if self.path != "/api/v1/heartbeat":
            self._json(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, OSError):
            self._json(400, {"error": "invalid json"})
            return
        agent_id = body.get("agent_id")
        if agent_id not in KNOWN_AGENTS:
            self._json(400, {"error": "unknown agent_id", "known": sorted(KNOWN_AGENTS)})
            return
        if TOKENS:
            auth = self.headers.get("Authorization", "")
            if auth != f"Bearer {TOKENS.get(agent_id, '')}":
                self._json(401, {"error": "unauthorized"})
                return
        status = body.get("status", "working")
        if status not in ("working", "idle", "offline"):
            self._json(400, {"error": "status must be working|idle|offline"})
            return
        with _lock:
            _state[agent_id].update({
                "status": status,
                "task": str(body.get("task", ""))[:500],
                "detail": str(body.get("detail", ""))[:500],
                "last_seen": body.get("ts") or _now_iso(),
            })
            _save()
            snap = _snapshot()
        _broadcast(snap)
        self._json(200, {"ok": True, "agent_id": agent_id})


if __name__ == "__main__":
    _load()
    print(f"Sync API listening on {HOST}:{PORT} (data: {DATA_FILE})", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
