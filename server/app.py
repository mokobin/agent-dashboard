#!/usr/bin/env python3
"""
BOLO Agent Sync API — stdlib only (Python 3.9+).

Endpoints (all under /api/v1):
  GET  /health                     liveness probe
  GET  /status                     snapshot of all agents
  GET  /events                     SSE stream (snapshot, agent, feed, command, ping)
  POST /heartbeat                  agent reports status         (Bearer <agent token>)
  GET  /feed?limit=50              recent activity feed
  GET  /commands?agent_id=&state=  command queue
  POST /commands                   enqueue command for one/all  (Bearer <admin token>)
  POST /commands/<id>/ack          agent acknowledges a command (Bearer <agent token>)

Configuration (environment, never in the repo):
  BOLO_TOKENS        "agent_id:token,agent_id:token,..."   per-agent tokens
  BOLO_ADMIN_TOKEN   token for the PWA "Pusat Perintah"
  BOLO_DB            SQLite path        (default ./data/state.db)
  BOLO_AGENTS        agents.json path   (default next to this file)
  BOLO_HOST/BOLO_PORT                   (default 127.0.0.1:8787)
  BOLO_OFFLINE_AFTER seconds without heartbeat -> offline (default 60)
  BOLO_CORS_ORIGIN   optional, e.g. "*" for local dev (same-origin in prod)
"""
from __future__ import annotations

import hmac
import json
import os
import queue
import re
import sqlite3
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

VERSION = "1.0.0"
HERE = os.path.dirname(os.path.abspath(__file__))

HOST = os.environ.get("BOLO_HOST", "127.0.0.1")
PORT = int(os.environ.get("BOLO_PORT", "8787"))
DB_PATH = os.environ.get("BOLO_DB", os.path.join(HERE, "data", "state.db"))
AGENTS_PATH = os.environ.get("BOLO_AGENTS", os.path.join(HERE, "agents.json"))
OFFLINE_AFTER = float(os.environ.get("BOLO_OFFLINE_AFTER", "60"))
CORS_ORIGIN = os.environ.get("BOLO_CORS_ORIGIN", "")
STATIC_DIR = os.environ.get("BOLO_STATIC_DIR", "")  # optional: serve pwa/ too (dev / no-nginx)
MAX_BODY = 16 * 1024
MAX_SSE_CLIENTS = int(os.environ.get("BOLO_MAX_SSE", "200"))
FEED_KEEP = 2000

VALID_STATUS = {"working", "idle", "offline"}
LIMITS = {"task": 280, "detail": 2000, "text": 1000, "note": 1000}


def now() -> float:
    return time.time()


def iso(ts: float | None) -> str | None:
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def log(*a):
    print(datetime.now().strftime("%Y-%m-%d %H:%M:%S"), *a, file=sys.stderr, flush=True)


def parse_tokens(raw: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for part in (raw or "").split(","):
        part = part.strip()
        if not part or ":" not in part:
            continue
        aid, tok = part.split(":", 1)
        if aid.strip() and tok.strip():
            out[aid.strip()] = tok.strip()
    return out


# --------------------------------------------------------------------------- store
class Store:
    """SQLite (WAL) — survives restarts, no external DB."""

    def __init__(self, path: str, agents: list[dict]):
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        with self.lock:
            self.db.execute("PRAGMA journal_mode=WAL")
            self.db.execute("PRAGMA synchronous=NORMAL")
            self.db.executescript(
                """
                CREATE TABLE IF NOT EXISTS agents (
                  agent_id TEXT PRIMARY KEY,
                  status TEXT NOT NULL DEFAULT 'offline',
                  task TEXT, detail TEXT, progress REAL,
                  reported_ts TEXT,
                  last_seen REAL,
                  task_started REAL,
                  was_online INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS feed (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  ts REAL NOT NULL, agent_id TEXT, kind TEXT NOT NULL, text TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS commands (
                  id TEXT PRIMARY KEY,
                  created REAL NOT NULL, target TEXT NOT NULL, text TEXT NOT NULL,
                  state TEXT NOT NULL DEFAULT 'queued', note TEXT, updated REAL
                );
                CREATE INDEX IF NOT EXISTS idx_cmd_target ON commands(target, state);
                """
            )
            for a in agents:
                self.db.execute("INSERT OR IGNORE INTO agents(agent_id) VALUES (?)", (a["agent_id"],))

    # agents ---------------------------------------------------------------
    def get_agent_row(self, agent_id: str):
        with self.lock:
            return self.db.execute("SELECT * FROM agents WHERE agent_id=?", (agent_id,)).fetchone()

    def all_agent_rows(self):
        with self.lock:
            return {r["agent_id"]: r for r in self.db.execute("SELECT * FROM agents")}

    def save_heartbeat(self, agent_id, status, task, detail, progress, reported_ts, seen, task_started):
        with self.lock:
            self.db.execute(
                """UPDATE agents SET status=?, task=?, detail=?, progress=?, reported_ts=?,
                   last_seen=?, task_started=?, was_online=? WHERE agent_id=?""",
                (status, task, detail, progress, reported_ts, seen, task_started,
                 0 if status == "offline" else 1, agent_id),
            )

    def set_was_online(self, agent_id, v: bool):
        with self.lock:
            self.db.execute("UPDATE agents SET was_online=? WHERE agent_id=?", (1 if v else 0, agent_id))

    # feed -----------------------------------------------------------------
    def add_feed(self, agent_id, kind, text, ts=None) -> dict:
        ts = ts or now()
        with self.lock:
            cur = self.db.execute("INSERT INTO feed(ts,agent_id,kind,text) VALUES (?,?,?,?)", (ts, agent_id, kind, text))
            fid = cur.lastrowid
            if fid % 200 == 0:
                self.db.execute("DELETE FROM feed WHERE id <= ?", (fid - FEED_KEEP,))
        return {"id": fid, "ts": iso(ts), "agent_id": agent_id, "kind": kind, "text": text}

    def feed(self, limit=50):
        with self.lock:
            rows = self.db.execute("SELECT * FROM feed ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [{"id": r["id"], "ts": iso(r["ts"]), "agent_id": r["agent_id"], "kind": r["kind"], "text": r["text"]} for r in rows]

    # commands -------------------------------------------------------------
    @staticmethod
    def _cmd(r) -> dict:
        return {"id": r["id"], "created": iso(r["created"]), "target": r["target"], "text": r["text"],
                "state": r["state"], "note": r["note"], "updated": iso(r["updated"])}

    def add_command(self, target, text) -> dict:
        cid = uuid.uuid4().hex[:12]
        t = now()
        with self.lock:
            self.db.execute("INSERT INTO commands(id,created,target,text,state,updated) VALUES (?,?,?,?, 'queued', ?)",
                            (cid, t, target, text, t))
            r = self.db.execute("SELECT * FROM commands WHERE id=?", (cid,)).fetchone()
        return self._cmd(r)

    def commands(self, agent_id=None, state=None, limit=100):
        q, args = "SELECT * FROM commands WHERE 1=1", []
        if agent_id:
            q += " AND (target=? OR target='all')"
            args.append(agent_id)
        if state:
            q += " AND state=?"
            args.append(state)
        q += " ORDER BY created DESC LIMIT ?"
        args.append(limit)
        with self.lock:
            return [self._cmd(r) for r in self.db.execute(q, args)]

    def ack_command(self, cid, agent_id, state, note):
        with self.lock:
            r = self.db.execute("SELECT * FROM commands WHERE id=?", (cid,)).fetchone()
            if not r:
                return None, "not_found"
            if r["target"] not in (agent_id, "all"):
                return None, "forbidden"
            self.db.execute("UPDATE commands SET state=?, note=?, updated=? WHERE id=?", (state, note, now(), cid))
            r = self.db.execute("SELECT * FROM commands WHERE id=?", (cid,)).fetchone()
        return self._cmd(r), None


# --------------------------------------------------------------------------- hub
class Hub:
    """Fan-out of SSE events to connected clients."""

    def __init__(self):
        self.clients: set[queue.Queue] = set()
        self.lock = threading.Lock()
        self.seq = 0

    def subscribe(self) -> queue.Queue | None:
        with self.lock:
            if len(self.clients) >= MAX_SSE_CLIENTS:
                return None
            q: queue.Queue = queue.Queue(maxsize=500)
            self.clients.add(q)
            return q

    def unsubscribe(self, q):
        with self.lock:
            self.clients.discard(q)

    def publish(self, event: str, data) -> None:
        with self.lock:
            self.seq += 1
            msg = f"id: {self.seq}\nevent: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode()
            dead = []
            for q in self.clients:
                try:
                    q.put_nowait(msg)
                except queue.Full:
                    dead.append(q)
            for q in dead:
                self.clients.discard(q)

    def count(self):
        with self.lock:
            return len(self.clients)


# --------------------------------------------------------------------------- app
class App:
    def __init__(self):
        with open(AGENTS_PATH, encoding="utf-8") as f:
            self.agents = json.load(f)["agents"]
        self.meta = {a["agent_id"]: a for a in self.agents}
        self.tokens = parse_tokens(os.environ.get("BOLO_TOKENS", ""))
        self.admin_token = os.environ.get("BOLO_ADMIN_TOKEN", "").strip()
        unknown = set(self.tokens) - set(self.meta)
        if unknown:
            log("WARN tokens for unknown agents ignored:", ", ".join(sorted(unknown)))
        missing = set(self.meta) - set(self.tokens)
        if missing:
            log("WARN no token configured for:", ", ".join(sorted(missing)), "(their heartbeats will be rejected)")
        self.store = Store(DB_PATH, self.agents)
        self.hub = Hub()
        self.started = now()
        self.fail_lock = threading.Lock()
        self.fails: dict[str, list[float]] = {}

    # ---- views
    def agent_view(self, aid: str, row=None, t=None) -> dict:
        t = t or now()
        m = self.meta[aid]
        row = row if row is not None else self.store.get_agent_row(aid)
        last_seen = row["last_seen"] if row else None
        fresh = last_seen is not None and (t - last_seen) <= OFFLINE_AFTER
        status = row["status"] if row else "offline"
        online = bool(fresh and status != "offline")
        return {
            "agent_id": aid,
            "name": m.get("name", aid),
            "alias": m.get("alias"),
            "platform": m.get("platform"),
            "role": m.get("role"),
            "color": m.get("color"),
            "desk": m.get("desk"),
            "status": status if online else "offline",
            "reported_status": status,
            "task": row["task"] if row else None,
            "detail": row["detail"] if row else None,
            "progress": row["progress"] if row else None,
            "task_started": iso(row["task_started"]) if row else None,
            "reported_ts": row["reported_ts"] if row else None,
            "last_seen": iso(last_seen),
            "seconds_since_seen": None if last_seen is None else round(t - last_seen, 1),
            "online": online,
        }

    def snapshot(self) -> dict:
        t = now()
        rows = self.store.all_agent_rows()
        return {
            "server_time": iso(t),
            "offline_after": OFFLINE_AFTER,
            "version": VERSION,
            "agents": [self.agent_view(a["agent_id"], rows.get(a["agent_id"]), t) for a in self.agents],
        }

    # ---- auth
    def check_agent_token(self, header: str, agent_id: str) -> bool:
        expected = self.tokens.get(agent_id)
        given = header[7:].strip() if header.lower().startswith("bearer ") else ""
        return bool(expected and given and hmac.compare_digest(expected.encode(), given.encode()))

    def check_admin(self, header: str) -> bool:
        given = header[7:].strip() if header.lower().startswith("bearer ") else ""
        return bool(self.admin_token and given and hmac.compare_digest(self.admin_token.encode(), given.encode()))

    def throttled(self, ip: str) -> bool:
        t = now()
        with self.fail_lock:
            lst = [x for x in self.fails.get(ip, []) if t - x < 60]
            self.fails[ip] = lst
            return len(lst) >= 20

    def note_fail(self, ip: str):
        with self.fail_lock:
            self.fails.setdefault(ip, []).append(now())

    # ---- actions
    def heartbeat(self, body: dict) -> tuple[int, dict]:
        aid = str(body.get("agent_id", "")).strip()
        status = str(body.get("status", "")).strip().lower()
        if aid not in self.meta:
            return 400, {"error": "unknown agent_id", "known": list(self.meta)}
        if status not in VALID_STATUS:
            return 400, {"error": "status must be working|idle|offline"}
        task = clean(body.get("task"), LIMITS["task"])
        detail = clean(body.get("detail"), LIMITS["detail"])
        progress = body.get("progress")
        if progress is not None:
            try:
                progress = max(0.0, min(100.0, float(progress)))
            except (TypeError, ValueError):
                return 400, {"error": "progress must be a number 0-100"}
        reported_ts = clean(body.get("ts"), 40)

        t = now()
        prev = self.store.get_agent_row(aid)
        prev_view = self.agent_view(aid, prev, t)
        task_changed = (prev is None or prev["task"] != task or prev["status"] != status
                        or not prev_view["online"])
        task_started = t if task_changed else (prev["task_started"] or t)
        self.store.save_heartbeat(aid, status, task, detail, progress, reported_ts, t, task_started)
        view = self.agent_view(aid, t=t)
        self.hub.publish("agent", view)

        name = self.meta[aid].get("name", aid)
        feed = None
        if not prev_view["online"] and view["online"]:
            feed = f"{name} online — {status}" + (f": {task}" if task else "")
        elif status == "offline" and prev_view["online"]:
            feed = f"{name} keluar (offline)"
        elif prev is not None and prev["status"] != status:
            feed = f"{name} → {status}" + (f": {task}" if task else "")
        elif prev is not None and (prev["task"] or "") != (task or ""):
            feed = f"{name} mulai: {task}" if task else f"{name} selesai tugas"
        if feed:
            self.hub.publish("feed", self.store.add_feed(aid, "status", feed, t))
        return 200, {"ok": True, "agent": view}

    def enqueue(self, body: dict) -> tuple[int, dict]:
        target = str(body.get("target", "")).strip()
        text = clean(body.get("text"), LIMITS["text"])
        if target != "all" and target not in self.meta:
            return 400, {"error": "target must be an agent_id or 'all'"}
        if not text:
            return 400, {"error": "text required"}
        cmd = self.store.add_command(target, text)
        self.hub.publish("command", cmd)
        who = "semua agent" if target == "all" else self.meta[target].get("name", target)
        self.hub.publish("feed", self.store.add_feed(None if target == "all" else target, "command",
                                                     f"Perintah ke {who}: {text}"))
        return 201, {"ok": True, "command": cmd}

    def ack(self, cid: str, agent_id: str, body: dict) -> tuple[int, dict]:
        state = str(body.get("state", "")).strip()
        if state not in {"received", "running", "done", "failed"}:
            return 400, {"error": "state must be received|running|done|failed"}
        cmd, err = self.store.ack_command(cid, agent_id, state, clean(body.get("note"), LIMITS["note"]))
        if err == "not_found":
            return 404, {"error": "command not found"}
        if err == "forbidden":
            return 403, {"error": "command not addressed to this agent"}
        self.hub.publish("command", cmd)
        name = self.meta[agent_id].get("name", agent_id)
        self.hub.publish("feed", self.store.add_feed(agent_id, "command", f"{name} perintah #{cid[:6]} → {state}"))
        return 200, {"ok": True, "command": cmd}

    # ---- watchdog: flip agents to offline after OFFLINE_AFTER without heartbeat
    def watchdog(self):
        while True:
            time.sleep(2)
            try:
                t = now()
                for aid, row in self.store.all_agent_rows().items():
                    if aid not in self.meta:
                        continue
                    v = self.agent_view(aid, row, t)
                    if row["was_online"] and not v["online"]:
                        self.store.set_was_online(aid, False)
                        self.hub.publish("agent", v)
                        name = self.meta[aid].get("name", aid)
                        self.hub.publish("feed", self.store.add_feed(
                            aid, "offline", f"{name} tidak ada heartbeat >{int(OFFLINE_AFTER)} dtk — offline", t))
            except Exception as e:  # keep running no matter what
                log("watchdog error:", e)


def clean(v, maxlen):
    if v is None:
        return None
    s = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", str(v)).strip()
    return s[:maxlen] if s else None


APP: App | None = None
CMD_ACK = re.compile(r"^/api/v1/commands/([a-f0-9]{6,32})/ack$")


# --------------------------------------------------------------------------- http
class Handler(BaseHTTPRequestHandler):
    server_version = f"BoloSync/{VERSION}"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        if os.environ.get("BOLO_ACCESS_LOG"):
            log(self.client_ip(), fmt % args)

    def client_ip(self):
        xff = self.headers.get("X-Forwarded-For", "")
        return (xff.split(",")[0].strip() if xff else "") or self.client_address[0]

    def cors(self):
        if CORS_ORIGIN:
            self.send_header("Access-Control-Allow-Origin", CORS_ORIGIN)
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def send_json(self, code: int, obj):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.cors()
        self.end_headers()
        self.wfile.write(data)

    def read_json(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = -1
        if n < 0 or n > MAX_BODY:
            return None, (413, {"error": "body too large"})
        raw = self.rfile.read(n) if n else b""
        try:
            body = json.loads(raw or b"{}")
            if not isinstance(body, dict):
                raise ValueError
            return body, None
        except ValueError:
            return None, (400, {"error": "invalid JSON object"})

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        p = u.path.rstrip("/")
        if p == "/api/v1/health":
            return self.send_json(200, {"ok": True, "version": VERSION, "uptime": round(now() - APP.started),
                                        "sse_clients": APP.hub.count(), "server_time": iso(now())})
        if p == "/api/v1/status":
            return self.send_json(200, APP.snapshot())
        if p == "/api/v1/feed":
            limit = clamp_int(qs.get("limit", ["50"])[0], 1, 500, 50)
            return self.send_json(200, {"feed": APP.store.feed(limit)})
        if p == "/api/v1/commands":
            aid = qs.get("agent_id", [None])[0]
            state = qs.get("state", [None])[0]
            limit = clamp_int(qs.get("limit", ["100"])[0], 1, 500, 100)
            return self.send_json(200, {"commands": APP.store.commands(aid, state, limit)})
        if p == "/api/v1/events":
            return self.sse()
        if STATIC_DIR and not u.path.startswith("/api/"):
            return self.static(u.path)
        return self.send_json(404, {"error": "not found"})

    def static(self, path: str):
        """Dev/standalone convenience only — in production nginx serves pwa/."""
        rel = os.path.normpath(path.lstrip("/") or "index.html")
        full = os.path.realpath(os.path.join(STATIC_DIR, rel))
        root = os.path.realpath(STATIC_DIR)
        if not full.startswith(root + os.sep) and full != root:
            return self.send_json(403, {"error": "forbidden"})
        if os.path.isdir(full):
            full = os.path.join(full, "index.html")
        if not os.path.isfile(full):
            full = os.path.join(root, "index.html")
        ext = os.path.splitext(full)[1].lower()
        ctype = {".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
                 ".css": "text/css; charset=utf-8", ".json": "application/manifest+json" if full.endswith("manifest.json") else "application/json",
                 ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon"}.get(ext, "application/octet-stream")
        with open(full, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache" if ext in (".html", ".js", ".json") else "public, max-age=86400")
        if full.endswith("sw.js"):
            self.send_header("Service-Worker-Allowed", "/")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        p = urlparse(self.path).path.rstrip("/")
        ip = self.client_ip()
        auth = self.headers.get("Authorization", "")
        if APP.throttled(ip):
            return self.send_json(429, {"error": "too many failed auth attempts, wait a minute"})
        body, err = self.read_json()
        if err:
            return self.send_json(*err)

        if p == "/api/v1/heartbeat":
            aid = str(body.get("agent_id", "")).strip()
            if not APP.check_agent_token(auth, aid):
                APP.note_fail(ip)
                return self.send_json(401, {"error": "invalid or missing token for this agent_id"})
            return self.send_json(*APP.heartbeat(body))

        if p == "/api/v1/commands":
            if not APP.check_admin(auth):
                APP.note_fail(ip)
                return self.send_json(401, {"error": "admin token required"})
            return self.send_json(*APP.enqueue(body))

        m = CMD_ACK.match(p)
        if m:
            aid = str(body.get("agent_id", "")).strip()
            if not APP.check_agent_token(auth, aid):
                APP.note_fail(ip)
                return self.send_json(401, {"error": "invalid or missing token for this agent_id"})
            return self.send_json(*APP.ack(m.group(1), aid, body))

        return self.send_json(404, {"error": "not found"})

    def sse(self):
        q = APP.hub.subscribe()
        if q is None:
            return self.send_json(503, {"error": "too many live clients"})
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache, no-transform")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")  # nginx: don't buffer
            self.cors()
            self.end_headers()
            self.close_connection = True
            first = {"snapshot": APP.snapshot(), "feed": APP.store.feed(30), "commands": APP.store.commands(limit=50)}
            self.wfile.write(b"retry: 3000\n")
            self.wfile.write(f"event: snapshot\ndata: {json.dumps(first, ensure_ascii=False)}\n\n".encode())
            self.wfile.flush()
            last_ping = now()
            while True:
                try:
                    msg = q.get(timeout=1.0)
                    self.wfile.write(msg)
                    self.wfile.flush()
                except queue.Empty:
                    pass
                if now() - last_ping >= 15:
                    self.wfile.write(f"event: ping\ndata: {json.dumps({'server_time': iso(now())})}\n\n".encode())
                    self.wfile.flush()
                    last_ping = now()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            pass
        finally:
            APP.hub.unsubscribe(q)


def clamp_int(v, lo, hi, default):
    try:
        return max(lo, min(hi, int(v)))
    except (TypeError, ValueError):
        return default


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    global APP
    APP = App()
    threading.Thread(target=APP.watchdog, daemon=True, name="watchdog").start()
    srv = Server((HOST, PORT), Handler)
    log(f"BOLO Sync API {VERSION} on http://{HOST}:{PORT}  db={DB_PATH}  offline_after={OFFLINE_AFTER}s  "
        f"agents={len(APP.agents)} tokens={len(APP.tokens)} admin={'yes' if APP.admin_token else 'no'}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
