# BOLO HQ — Agent Dashboard PWA (`boloku.web.id`)

Kantor virtual isometrik yang menampilkan status **asli** lima agent:
Bolo_airdrop, Bolongonten, Hunter-2 / Nanika (Hermes) dan Mas Wowo, Mas Wiwi (Muse).
Tiap agent duduk di mejanya; bubble di atas kepala menunjukkan tugas yang sedang
dikerjakan, mengetik saat `working`, kopi mengepul saat `idle`, kursi kosong + papan
AWAY saat `offline`. Jam dinding mengikuti WIB, ada kucing tidur dan jendela kota malam.

```
[Agent Hermes di VPS] --POST heartbeat--> [Sync API :8787] <--GET/SSE-- [PWA boloku.web.id]
[Agent Muse]          --POST heartbeat--> (nginx /api/ → 127.0.0.1:8787)
```

| Folder | Isi |
|---|---|
| `pwa/` | Front-end (HTML/CSS/JS murni, tanpa build), `manifest.json`, `sw.js`, ikon. ±150 KB total |
| `server/` | Sync API Python **stdlib-only** + SQLite (WAL), `agents.json`, `gen-tokens.py`, tes |
| `reporter/` | `report-status.sh`, `with-status.sh`, `keepalive.sh`, `bolo_report.py`, `MUSE-REPORTING.md` |
| `deploy/` | nginx server block, unit systemd, `install.sh`, `write-agent-token.sh`, `TUNNEL.md` |
| `tests/acceptance.sh` | Acceptance test 1–5 sesuai brief |
| `docs/` | `PROMPT-CLAUDE-CODE.md` (brief) + `prototype.html` (referensi tampilan awal, tidak ikut di-deploy) |

## Fitur

- **Live**: snapshot `GET /status` → langganan SSE `GET /events`. SSE putus → polling 5 dtk otomatis, reconnect sendiri.
- **Offline**: service worker cache app shell + snapshot terakhir. Buka tanpa jaringan → tampil data terakhir + penanda waktu.
- **Jujur soal data**: label koneksi `LIVE / POLLING / DATA TERAKHIR / SIMULASI`. Data simulasi hanya muncul bila API belum pernah tersambung, dengan banner merah + watermark SIMULASI dan prefix di tiap bubble. Pusat Perintah nonaktif saat simulasi.
- **Offline detection di dua sisi**: server (watchdog → event + feed "tidak ada heartbeat >60 dtk") dan klien (hitung ulang tiap detik dengan koreksi selisih jam server).
- **Panel Kendali** per platform (HERMES/MUSE): status, tugas, progress bar, timer sesi tugas, "dilihat x lalu". Ketuk agent/meja/bubble → detail lengkap.
- **Pusat Perintah**: kirim ke satu agent atau semua → antrean + feed (pakai admin token, disimpan di perangkat). Agent bisa membaca & `ack` perintah (groundwork fase berikut).
- Installable (manifest + ikon maskable + tombol install), responsif (scene bisa digeser di HP), `prefers-reduced-motion` dihormati.

## Kontrak API (`/api/v1`)

| Method | Path | Auth | Keterangan |
|---|---|---|---|
| GET | `/health` | – | `{ok, version, uptime, sse_clients}` |
| GET | `/status` | – | `{server_time, offline_after, agents:[{agent_id, name, alias, platform, status, reported_status, task, detail, progress, task_started, last_seen, online, …}]}` |
| GET | `/events` | – | SSE: `snapshot` (awal), `agent`, `feed`, `command`, `ping` (15 dtk) |
| POST | `/heartbeat` | Bearer token agent | `{"agent_id","status":"working\|idle\|offline","task","detail","progress"?,"ts"}` |
| GET | `/feed?limit=50` | – | Feed aktivitas |
| GET | `/commands?agent_id=&state=` | – | Antrean perintah |
| POST | `/commands` | Bearer admin | `{"target":"<agent_id>\|all","text"}` |
| POST | `/commands/<id>/ack` | Bearer token agent | `{"agent_id","state":"received\|running\|done\|failed","note"}` |

Aturan: tidak ada heartbeat > 60 dtk → `online:false`, `status:"offline"`, `last_seen` tetap. `last_seen` memakai waktu terima server (bukan `ts` kiriman agent), jadi jam agent yang meleset tidak memalsukan status. Token dibandingkan konstan-waktu; 20 auth gagal/menit per IP → 429. Body maks 16 KB.

## Deploy ke VPS (Oracle, nginx sudah aktif)

```bash
# di VPS, dari checkout repo
sudo bash deploy/install.sh
```
Yang dilakukan: user `boloku`; kode → `/opt/boloku`; SQLite → `/var/lib/boloku/state.db`;
token baru → `/etc/boloku/sync.env` (600/640, **ditampilkan sekali**, hanya jika belum ada);
`bolo-sync.service` enabled + started; **satu** server block nginx baru untuk
`boloku.web.id`; `nginx -t` + reload; cek health lokal. Tidak menyentuh DNS, panel, chisel,
atau firewall. Jejak disk: < 1 MB kode + DB kecil (feed dipangkas otomatis 2000 baris).

Lalu:
1. **HTTPS** — ikuti `deploy/TUNNEL.md` (cek pola chisel panel dulu, read-only).
   ⚠️ Kalau DNS `panel-api.boloku.web.id` ternyata **tidak** menunjuk ke 168.110.193.123, A record
   `boloku.web.id` juga harus ikut ke host edge yang sama. Kalau diarahkan ke IP VPS, HTTPS akan timeout
   karena port 443 VPS tidak listen.
2. **Token agent Hermes** (di VPS): `sudo bash deploy/write-agent-token.sh hunter-2 <user-yang-menjalankan-hunter-2>`
   (ulangi untuk bolo_airdrop, bolongonten). Opsional agar selalu tampil online:
   `sudo systemctl enable --now bolo-keepalive@hunter-2` (set `User=` di unit).
3. **Admin token** → buka PWA → ⚙ Pengaturan → tempel. Tersimpan hanya di perangkat itu.
4. **Muse** → `reporter/MUSE-REPORTING.md` (prompt siap tempel untuk Mas Wowo & Mas Wiwi).
5. **Acceptance**: `BOLO_AGENT=hunter-2 BOLO_TOKEN=… bash tests/acceptance.sh https://boloku.web.id`

Rotasi token: `sudo python3 /opt/boloku/server/gen-tokens.py /etc/boloku/sync.env --force && sudo systemctl restart bolo-sync`.

## Cara tiap agent melapor

```bash
export BOLO_API=https://boloku.web.id/api/v1          # di VPS boleh http://127.0.0.1:8787/api/v1
# token: env BOLO_TOKEN atau ~/.config/boloku/<agent_id>.token (600)

reporter/report-status.sh hunter-2 working "Scan airdrop baru" "chain 3/14" 20   # sekali lapor
reporter/report-status.sh hunter-2 idle "Selesai: Scan airdrop baru"
reporter/with-status.sh hunter-2 "Scan airdrop baru" -- python3 scan.py          # heartbeat otomatis tiap 20 dtk, idle saat selesai/gagal
echo "working|Pantau channel pengumuman" > ~/.config/boloku/hunter-2.state          # dipakai keepalive.sh
```
Python: `from bolo_report import Reporter; with Reporter("hunter-2").task("Scan airdrop"): ...`

Kapan melapor: mulai tugas, ganti tugas, tiap ≤45 dtk selama bekerja, selesai/gagal, sesi berakhir.
Token tidak pernah lewat argumen CLI (tidak terlihat di `ps`).

## Jalankan lokal

```bash
python3 server/gen-tokens.py /tmp/bolo.env && set -a && . /tmp/bolo.env && set +a
BOLO_DB=/tmp/bolo.db BOLO_STATIC_DIR=$PWD/pwa python3 server/app.py   # http://127.0.0.1:8787
python3 server/test_app.py                                            # 5 tes end-to-end
```
`?demo=1` memaksa mode SIMULASI; `?api=<url>` mengganti API base.

## Menambah/mengubah agent
Edit `server/agents.json` (id, nama, platform, warna, nomor meja 0–4) lalu tambah tokennya di `sync.env`.
PWA otomatis mengikuti daftar dari `/status`.
