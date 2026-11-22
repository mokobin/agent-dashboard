# Instruksi Pelaporan — Mas Wowo & Mas Wiwi (platform Muse)

Tempel blok **PROMPT** di bawah ke instruksi/system prompt masing-masing agent
Muse. Ganti `<AGENT_ID>` dengan `mas-wowo` atau `mas-wiwi`. Token **tidak**
ditulis di prompt: simpan di env `BOLO_TOKEN` atau file
`~/.config/boloku/<AGENT_ID>.token` (chmod 600) di lingkungan agent itu.

---

## PROMPT (salin apa adanya)

```
Kamu terhubung ke dashboard BOLO HQ (https://boloku.web.id). Dashboard ini
menampilkan statusmu yang ASLI ke Mas Rudy, jadi laporkan dengan jujur.

ID kamu: <AGENT_ID>
Endpoint: POST https://boloku.web.id/api/v1/heartbeat
Header:   Authorization: Bearer $BOLO_TOKEN   (ambil dari env / file token; JANGAN pernah tulis token di chat, log, atau file repo)
Body JSON: {"agent_id":"<AGENT_ID>","status":"working|idle|offline","task":"<ringkas, ≤280 karakter>","detail":"<opsional>","progress":<opsional 0-100>}

KAPAN melapor:
1. Saat MULAI tugas          -> status "working", task = apa yang sedang dikerjakan (kalimat pendek, bahasa Indonesia).
2. Saat GANTI tugas          -> "working" dengan task baru.
3. Selama tugas berjalan     -> ulangi heartbeat paling lambat tiap 45 detik (lebih dari 60 detik tanpa heartbeat = tampil OFFLINE).
                                Untuk perintah shell yang lama, bungkus dengan with-status.sh (lihat di bawah) supaya heartbeat otomatis.
4. Saat ada kemajuan berarti -> sertakan "progress" (0-100) dan/atau "detail".
5. Saat SELESAI tugas        -> "idle", task = "Selesai: <tugas>".
6. Saat GAGAL                -> "idle", task = "Gagal: <tugas>", detail = alasan singkat.
7. Saat SESI BERAKHIR        -> "offline".

ATURAN:
- Hanya laporkan yang benar-benar sedang/sudah kamu kerjakan. Jangan mengarang status.
- Kalau heartbeat gagal (jaringan/HTTP error), lanjutkan tugas utama; jangan berhenti karena pelaporan.
- Jangan pernah menampilkan token di output.

PERINTAH (pakai yang tersedia di lingkunganmu):

# A. Ada repo reporter (paling mudah):
reporter/report-status.sh <AGENT_ID> working "Susun naskah recap chapter 120"
reporter/report-status.sh <AGENT_ID> working "Render video" "scene 12/40" 30
reporter/report-status.sh <AGENT_ID> idle "Selesai: Render video"
reporter/with-status.sh  <AGENT_ID> "Upload video ke YouTube" -- python3 upload.py   # heartbeat otomatis tiap 20 dtk

# B. Hanya curl:
curl -sS -X POST https://boloku.web.id/api/v1/heartbeat \
  -H "Authorization: Bearer $BOLO_TOKEN" -H "Content-Type: application/json" \
  -d '{"agent_id":"<AGENT_ID>","status":"working","task":"Susun naskah recap chapter 120"}'

# C. Python:
from bolo_report import Reporter
r = Reporter("<AGENT_ID>")
with r.task("Susun naskah recap chapter 120"):
    ...            # heartbeat otomatis; idle "Selesai:" / "Gagal:" saat keluar
```

---

## Cek cepat setelah dipasang

1. Jalankan sekali: `reporter/report-status.sh <AGENT_ID> working "Tes koneksi dashboard"` → harus `ok ...`.
2. Buka https://boloku.web.id → bubble agent berubah dalam ±1 detik.
3. Diamkan 60+ detik → status jadi **Offline · terakhir terlihat …**.

## Perintah dari Pusat Perintah (opsional, fase berikutnya)

PWA bisa memasukkan perintah ke antrean. Agent dapat membacanya dan
memberi tanda terima (belum wajib di fase ini):

```
GET  https://boloku.web.id/api/v1/commands?agent_id=<AGENT_ID>&state=queued
POST https://boloku.web.id/api/v1/commands/<id>/ack
     Authorization: Bearer $BOLO_TOKEN
     {"agent_id":"<AGENT_ID>","state":"received|running|done|failed","note":"opsional"}
```
