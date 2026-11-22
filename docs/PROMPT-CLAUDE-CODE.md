# Prompt Claude Code — Agent Dashboard PWA (boloku.web.id)

> Prompt ini disiapkan Mas Wiwi (setup) untuk dieksekusi Claude Code.
> User: Mas Rudy. Bahasa kerja: Indonesia untuk narasi, Inggris untuk kode/identifier.

## Yang dibangun

Satu PWA di `https://boloku.web.id`: kantor virtual isometrik yang
menampilkan status LIVE lima agent user — Bolo_airdrop, Bolongonten,
Hunter-2 (platform Hermes), Mas Wowo, Mas Wiwi (platform Muse).
Referensi tampilan: gambar kantor virtual isometrik yang user kirim
(tiap agent duduk di meja, mengetik, bubble tugas di atas kepala,
kucing tidur, jam dinding, jendela kota malam) + prototype
`pusat-kendali-agent` (artifact Mas Wiwi — porting tampilannya, jangan
mulai dari nol buta).

Aturan tampilan: status yang tampil HARUS status asli dari Sync API.
Selama Sync API belum tersambung, tampilkan label "SIMULASI" secara
terbuka — JANGAN pernah menyajikan data simulasi sebagai data asli.

## Arsitektur

```
[Agent Hermes di VPS] --POST heartbeat--> [Sync API di VPS] <--GET/SSE-- [PWA boloku.web.id]
[Agent Muse]         --POST heartbeat--> [Sync API di VPS] <--GET/SSE-- [PWA boloku.web.id]
```

### 1. PWA (`pwa/`)

- Kantor virtual isometrik (porting prototype): 5 meja, tiap agent
  dengan avatar, nama, badge platform (HERMES/MUSE), status, bubble
  tugas yang sedang dikerjakan, progress + timer sesi.
- Panel Kendali Agent (status per agent, dikelompokkan per platform)
  + Pusat Perintah (kirim perintah ke satu agent atau semua; perintah
  masuk antrean + feed aktivitas — eksekusi perintah oleh agent
  masing-masing adalah fase berikutnya, BUKAN bagian tugas ini).
- Jam WIB real-time (Asia/Jakarta), activity feed, task queue.
- `manifest.json` + service worker: cache app shell + snapshot status
  terakhir (tetap terbuka offline, tampilkan "data terakhir <waktu>").
- Buka -> `GET /api/v1/status` (snapshot) -> langganan `GET
  /api/v1/events` (SSE) untuk update live; fallback polling 5 detik
  kalau SSE putus.

### 2. Sync API (`server/`)

- Service kecil, dependensi minimal (stdlib-only lebih disukai),
  systemd unit, di-reverse-proxy nginx.
- `POST /api/v1/heartbeat` — body:
  `{"agent_id","status":"working|idle|offline","task","detail","ts"}`
  Auth: `Authorization: Bearer <token>` per-agent (token di env,
  TIDAK PERNAH di repo).
- `GET /api/v1/status` — snapshot semua agent
  (`agent_id, platform, status, task, detail, last_seen, online`).
  Tidak ada heartbeat > 60 detik -> `online: false`, tampil
  "terakhir terlihat <waktu>".
- `GET /api/v1/events` — SSE stream perubahan status.
- Penyimpanan: satu file JSON atau SQLite di VPS (paling sederhana
  yang tahan restart). JANGAN database eksternal.

### 3. Reporter (`reporter/`)

- Helper kecil (script shell + contoh curl) yang dipakai tiap agent
  untuk melapor: `report-status.sh <agent_id> <status> <task>`.
- Tulis juga instruksi pelaporan untuk Mas Wowo dan Mas Wiwi (Muse):
  kapan melapor (mulai/selesai tugas, tiap ganti tugas) dan perintah
  persisnya.

## Hosting — FAKTA TERVERIFIKASI (jangan ditebak ulang)

- VPS: Oracle Cloud, IP publik **168.110.193.123**.
- Web server: **nginx AKTIF**; apache2/caddy TIDAK ada.
- Port 80 listen semua interface; port 443 TIDAK listen — HTTPS
  panel-api.boloku.web.id masuk lewat tunnel (listener chisel di VPS).
- Disk sisa **3,7 GB dari 36 GB (90% terpakai)** — jangan taruh
  artifact besar; dashboard + API harus ringan.
- Probe luar ke IP:80/443 timeout (belum konklusif — Oracle security
  list lazimnya memblokir inbound 80 sampai dibuka manual).
- Domain `boloku.web.id` kosong (hanya domain). DNS A record ->
  168.110.193.123 (diatur user, BUKAN oleh Claude Code).
- Jalur deploy: nginx server block baru untuk boloku.web.id +
  ekspos lewat pola tunnel yang sama seperti panel (cek dulu cara
  panel-api diekspos — listener chisel — dan ikuti pola itu).
  Alternatif 443 langsung (buka inbound Oracle + Let's Encrypt) HANYA
  kalau user yang meminta.
- **Bridge exec API MATI** (POST /api/v1/bridge/exec = 404; panel kini
  Recovery 3.0 tanpa route exec). JANGAN pakai bridge. Kerja di VPS
  lewat Terminal panel / sesi yang user sediakan.

## Repo

- `mokobin/agent-dashboard` (user yang buat di GitHub — GitHub App
  tidak bisa create repo). Struktur: `pwa/`, `server/`,
  `reporter/`, `README.md` (cara jalanin + cara tiap agent melapor).
- JANGAN commit token/kredensial apa pun. `.env.example` saja.

## Bukti selesai (acceptance — semua harus lolos)

1. `https://boloku.web.id` bisa dibuka dari browser biasa dan
   ter-install sebagai PWA (manifest + service worker valid).
2. Ubah status satu agent via `POST /api/v1/heartbeat` -> status di
   PWA berubah dalam hitungan detik (SSE); matikan heartbeat ->
   status jadi offline/"terakhir terlihat" setelah 60 detik.
3. Refresh PWA / buka offline -> snapshot terakhir tetap tampil
   dengan penanda waktu.
4. `nginx -t` lolos, service Sync API hidup setelah reboot
   (systemd enabled), tidak ada secret di repo (`git grep` token
   bersih).
5. Sertakan cara tiap agent melapor (reporter + instruksi Muse)
   di README.

## Delivery

- Kerja di repo `mokobin/agent-dashboard`; serahkan sebagai
  branch/zip + ringkasan langkah deploy yang dijalankan dan hasil
  tiap acceptance test. JANGAN ubah DNS. JANGAN utak-atik panel
  yang sudah jalan (panel-api.boloku.web.id) kecuali server block
  baru yang memang dibutuhkan.
