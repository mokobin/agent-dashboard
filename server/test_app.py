#!/usr/bin/env python3
"""End-to-end tests against a real server process. Run: python3 server/test_app.py"""
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from urllib.error import HTTPError

HERE = os.path.dirname(os.path.abspath(__file__))
TOK = {"hunter-2": "tok-hunter", "mas-wiwi": "tok-wiwi"}
ADMIN = "tok-admin"


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class SyncAPITest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.port = free_port()
        cls.base = f"http://127.0.0.1:{cls.port}/api/v1"
        cls.env = dict(os.environ, BOLO_PORT=str(cls.port), BOLO_DB=os.path.join(cls.tmp, "s.db"),
                       BOLO_OFFLINE_AFTER="3", BOLO_ADMIN_TOKEN=ADMIN,
                       BOLO_TOKENS=",".join(f"{k}:{v}" for k, v in TOK.items()))
        cls.start()

    @classmethod
    def start(cls):
        cls.proc = subprocess.Popen([sys.executable, os.path.join(HERE, "app.py")], env=cls.env,
                                    stderr=subprocess.DEVNULL)
        for _ in range(50):
            try:
                urllib.request.urlopen(cls.base + "/health", timeout=1)
                return
            except Exception:
                time.sleep(0.1)
        raise RuntimeError("server did not start")

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait()

    def req(self, method, path, body=None, token=None):
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(self.base + path, data=data, method=method)
        r.add_header("Content-Type", "application/json")
        if token:
            r.add_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(r, timeout=5) as resp:
                return resp.status, json.loads(resp.read())
        except HTTPError as e:
            return e.code, json.loads(e.read())

    def agent(self, aid):
        _, s = self.req("GET", "/status")
        return next(a for a in s["agents"] if a["agent_id"] == aid)

    def test_1_auth(self):
        self.assertEqual(self.req("POST", "/heartbeat", {"agent_id": "hunter-2", "status": "idle"})[0], 401)
        self.assertEqual(self.req("POST", "/heartbeat", {"agent_id": "hunter-2", "status": "idle"}, "tok-wiwi")[0], 401)
        self.assertEqual(self.req("POST", "/heartbeat", {"agent_id": "hunter-2", "status": "zzz"}, "tok-hunter")[0], 400)

    def test_2_heartbeat_and_offline(self):
        c, r = self.req("POST", "/heartbeat", {"agent_id": "hunter-2", "status": "working", "task": "Scan airdrop baru",
                                               "progress": 40}, "tok-hunter")
        self.assertEqual(c, 200)
        a = self.agent("hunter-2")
        self.assertTrue(a["online"])
        self.assertEqual(a["status"], "working")
        self.assertEqual(a["task"], "Scan airdrop baru")
        self.assertEqual(a["platform"], "hermes")
        time.sleep(3.5)
        a = self.agent("hunter-2")
        self.assertFalse(a["online"])
        self.assertEqual(a["status"], "offline")
        self.assertIsNotNone(a["last_seen"])

    def test_3_sse_receives_update(self):
        got = []

        def listen():
            r = urllib.request.urlopen(self.base + "/events", timeout=10)
            ev = None
            for line in r:
                line = line.decode().strip()
                if line.startswith("event:"):
                    ev = line[6:].strip()
                elif line.startswith("data:") and ev:
                    got.append((ev, json.loads(line[5:])))
                    if ev == "agent" and got[-1][1]["agent_id"] == "mas-wiwi":
                        return

        t = threading.Thread(target=listen, daemon=True)
        t.start()
        time.sleep(0.5)
        t0 = time.time()
        self.req("POST", "/heartbeat", {"agent_id": "mas-wiwi", "status": "working", "task": "Susun naskah"}, "tok-wiwi")
        t.join(5)
        self.assertEqual(got[0][0], "snapshot")
        ev = [g for g in got if g[0] == "agent" and g[1]["agent_id"] == "mas-wiwi"]
        self.assertTrue(ev, "no agent event received")
        self.assertEqual(ev[0][1]["task"], "Susun naskah")
        self.assertLess(time.time() - t0, 3)

    def test_4_commands(self):
        self.assertEqual(self.req("POST", "/commands", {"target": "all", "text": "x"}, "wrong")[0], 401)
        c, r = self.req("POST", "/commands", {"target": "hunter-2", "text": "Cek wallet"}, ADMIN)
        self.assertEqual(c, 201)
        cid = r["command"]["id"]
        _, lst = self.req("GET", "/commands?agent_id=hunter-2&state=queued")
        self.assertIn(cid, [x["id"] for x in lst["commands"]])
        self.assertEqual(self.req("POST", f"/commands/{cid}/ack", {"agent_id": "mas-wiwi", "state": "done"}, "tok-wiwi")[0], 403)
        c, r = self.req("POST", f"/commands/{cid}/ack", {"agent_id": "hunter-2", "state": "done", "note": "ok"}, "tok-hunter")
        self.assertEqual(c, 200)
        self.assertEqual(r["command"]["state"], "done")

    def test_5_survives_restart(self):
        self.req("POST", "/heartbeat", {"agent_id": "hunter-2", "status": "idle", "task": "Persist me"}, "tok-hunter")
        type(self).proc.terminate()
        type(self).proc.wait()
        type(self).start()
        self.assertEqual(self.agent("hunter-2")["task"], "Persist me")
        _, f = self.req("GET", "/feed?limit=5")
        self.assertTrue(f["feed"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
