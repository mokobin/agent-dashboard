# Agent Dashboard — Pusat Kendali Agent

Satu PWA di `https://boloku.web.id` yang menampilkan status **live** lima agent
user dalam satu kantor virtual isometrik:

- Hermes: `bolo_airdrop`, `bolongonten`, `hunter-2`
- Muse: `mas-wowo`, `mas-wiwi`

Arsitektur: tiap agent melapor (heartbeat) ke Sync API di VPS; PWA membaca
snapshot + update live (SSE) dari API yang sama.

```
[Agent Hermes di VPS] --POST heartbeat--> [Sync API di VPS] <--GET/SSE-- [PWA boloku.web.id]
[Agent Muse]         --POST heartbeat--> [Sync API di VPS] <--GET/SSE-- [PWA boloku.web.id]
```

## Struktur

```
pwa/        PWA: index.html (shell live), prototype.html (referensi tampilan
            kantor virtual isometrik), manifest.json, sw.js, icon.svg
server/     Sync API (Python stdlib, tanpa dependensi): sync_api.py
reporter/   report-status.sh — helper tiap agent melapor
docs/       PROMPT-CLAUDE-CODE.md — prompt eksekusi lengkap buat Claude Code
```

## Quickstart (lokal)

```bash
# 1. Jalankan Sync API (port 8001, data di server/data/status.json)
python3 server/sync_api.py

# 2. Lapor status satu agent (terminal lain)
SYNC_API_URL=http://127.0.0.1:8001 AGENT_TOKEN=dev \
  ./reporter/report-status.sh hunter-2 working "Audit QNAP battery run 4"

# 3. Buka PWA — sajikan folder pwa/ lewat web server apa pun, misal:
python3 -m http.server 8080 --directory pwa
# lalu buka http://127.0.0.1:8080 (PWA fetch /api/v1/status dari origin yang sama;
# untuk dev, jalankan di balik reverse proxy yang sama dengan API)
```

Tanpa `AGENT_TOKENS` di env, API jalan mode DEV (heartbeat apa pun
diterima, ada warning di log). Produksi WAJIB isi `AGENT_TOKENS`
(lihat `.env.example`).

## API

- `POST /api/v1/heartbeat` — body `{"agent_id","status","task","detail","ts"}`,
  header `Authorization: Bearer <token-per-agent>`.
  `status`: `working` | `idle` | `offline`.
- `GET /api/v1/status` — snapshot semua agent
  (`agent_id, platform, status, task, detail, last_seen, online`).
  Tidak ada heartbeat > 60 detik -> `online: false`.
- `GET /api/v1/events` — SSE stream perubahan status.
- `GET /health` — `{"ok": true}`.

## Hosting (terverifikasi 2026-11-22)

- VPS Oracle Cloud, IP publik `168.110.193.123`, **nginx AKTIF**
  (apache2/caddy tidak ada). Port 80 listen, port 443 TIDAK listen —
  HTTPS panel masuk lewat tunnel (chisel).
- Disk sisa 3,7 GB / 36 GB (90% terpakai) — dashboard + API harus ringan.
- Jalur deploy: nginx server block baru untuk `boloku.web.id` + ekspos
  lewat pola tunnel yang sama seperti panel. DNS A `boloku.web.id` ->
  `168.110.193.123`.
- Bridge exec API MATI (404, panel kini Recovery 3.0). Jangan pakai bridge.

## Status tampilan

`pwa/index.html` adalah shell live (data dari API, label LIVE/SIMULASI
jujur). `pwa/prototype.html` adalah prototype kantor virtual isometrik
— referensi tampilan yang harus dipindahkan Claude Code ke `index.html`
(lihat `docs/PROMPT-CLAUDE-CODE.md`).

## Keamanan

- Token per-agent HANYA di env (`.env`, TIDAK PERNAH di repo).
- `.gitignore` menutup `.env`, `server/data/`, log, dan cache.
