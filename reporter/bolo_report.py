#!/usr/bin/env python3
"""
Python reporter (stdlib only) — for agents written in Python.

  from bolo_report import Reporter
  r = Reporter("hunter-2")                 # token from BOLO_TOKEN or ~/.config/boloku/hunter-2.token
  with r.task("Scan airdrop baru"):        # working + auto heartbeat every 20s, idle on exit
      ...
      r.progress(50, "chain 7/14")

CLI:  python3 bolo_report.py <agent_id> <status> "<task>" [detail] [progress]
"""
import json
import os
import sys
import threading
import time
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timezone

API = os.environ.get("BOLO_API", "https://boloku.web.id/api/v1").rstrip("/")


def _token(agent_id):
    if os.environ.get("BOLO_TOKEN"):
        return os.environ["BOLO_TOKEN"].strip()
    for p in (os.path.expanduser(f"~/.config/boloku/{agent_id}.token"), f"/etc/boloku/agents/{agent_id}.token"):
        if os.path.isfile(p):
            return open(p).read().strip()
    raise RuntimeError(f"no token for {agent_id}")


class Reporter:
    def __init__(self, agent_id, api=API, interval=20):
        self.agent_id, self.api, self.interval = agent_id, api, interval
        self.token = _token(agent_id)
        self._status, self._task, self._detail, self._progress = "idle", None, None, None
        self._stop = threading.Event()
        self._thread = None

    def send(self, status, task=None, detail=None, progress=None):
        self._status, self._task, self._detail, self._progress = status, task, detail, progress
        body = {"agent_id": self.agent_id, "status": status, "task": task, "detail": detail,
                "ts": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")}
        if progress is not None:
            body["progress"] = progress
        req = urllib.request.Request(self.api + "/heartbeat", data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json", "Authorization": f"Bearer {self.token}"})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return json.loads(r.read())
        except Exception as e:  # reporting must never crash the agent
            print(f"[bolo_report] heartbeat failed: {e}", file=sys.stderr)
            return None

    def progress(self, pct, detail=None):
        self.send(self._status, self._task, detail or self._detail, pct)

    def _loop(self):
        while not self._stop.wait(self.interval):
            self.send(self._status, self._task, self._detail, self._progress)

    def start_keepalive(self):
        if not self._thread:
            self._stop.clear()
            self._thread = threading.Thread(target=self._loop, daemon=True)
            self._thread.start()

    def stop_keepalive(self):
        self._stop.set()
        self._thread = None

    @contextmanager
    def task(self, name, detail=None):
        self.send("working", name, detail, None)
        self.start_keepalive()
        try:
            yield self
        except BaseException as e:
            self.stop_keepalive()
            self.send("idle", f"Gagal: {name}", repr(e)[:500])
            raise
        else:
            self.stop_keepalive()
            self.send("idle", f"Selesai: {name}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    a = sys.argv[1:] + [None] * 3
    res = Reporter(a[0]).send(a[1], a[2], a[3], float(a[4]) if a[4] else None)
    print("ok" if res else "failed")
    sys.exit(0 if res else 1)
