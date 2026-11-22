# Mengekspos boloku.web.id lewat HTTPS (ikuti pola panel)

Fakta (2026-11-22): port 443 di VPS **tidak** listen; HTTPS
`panel-api.boloku.web.id` masuk lewat **tunnel (listener chisel di VPS)**.
Jadi TLS diterminasi di luar nginx VPS. `boloku.web.id` harus lewat jalur yang
sama — **jangan menebak**, cek dulu pola panel dengan perintah di bawah
(semua read-only, aman dijalankan).

## 1. Kenali pola panel (read-only)

```bash
ss -ltnp | grep -Ei 'chisel|:80 |:443 |:8000|:8080'
ps -eo pid,user,args | grep -i [c]hisel
systemctl list-units --all | grep -Ei 'chisel|tunnel|cloudflared'
systemctl cat $(systemctl list-units --all --plain --no-legend | awk '/chisel/{print $1}') 2>/dev/null
getent hosts panel-api.boloku.web.id boloku.web.id
```

Catat tiga hal: (a) argumen chisel (`server --reverse` atau `client ... R:...`),
(b) port lokal tujuan panel, (c) IP yang dituju DNS `panel-api.boloku.web.id`.

## 2. Pilih jalur

**A. DNS panel-api ≠ 168.110.193.123** (DNS menunjuk ke host edge/tunnel lain)
→ TLS dipegang host edge itu. Yang perlu:
1. Di host edge: tambah route `boloku.web.id` → tunnel → VPS `127.0.0.1:80`
   (sama seperti route panel, tinggal ganti host + port tujuan).
2. **DNS `boloku.web.id` harus menunjuk ke host edge yang sama dengan
   panel-api, BUKAN ke 168.110.193.123** — kalau A record diarahkan ke IP VPS,
   HTTPS akan timeout karena 443 VPS tidak listen. Sampaikan ini ke Mas Rudy
   sebelum dia mengatur DNS.
3. Header `Host: boloku.web.id` harus diteruskan (nginx memilih server block
   berdasarkan Host).

**B. DNS panel-api = 168.110.193.123 dan chisel server listen di 443/port lain**
→ chisel di VPS menerima koneksi luar. Lihat argumen `--backend` /
reverse proxy chisel: jika chisel meneruskan semua HTTP ke nginx `:80`,
server block baru sudah cukup (nginx memilah berdasarkan Host). Jika chisel
meneruskan ke panel langsung, tambahkan nginx di depan — **konsultasikan
dulu ke Mas Rudy, ini menyentuh panel**.

**C. Direct 443 (HANYA kalau Mas Rudy minta)**
1. Oracle Console → VCN → Security List: ingress TCP 80 & 443 dari 0.0.0.0/0.
2. Firewall OS (image Oracle Ubuntu memblokir via iptables):
   ```bash
   sudo iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```
3. A record `boloku.web.id` → 168.110.193.123 (diatur user).
4. `sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx -d boloku.web.id -d www.boloku.web.id`
   (port 443 lalu dipakai nginx — pastikan tidak bentrok dengan chisel).

## 3. Verifikasi

```bash
curl -sS -H 'Host: boloku.web.id' http://127.0.0.1/api/v1/health    # di VPS
curl -sS https://boloku.web.id/api/v1/health                          # dari luar
curl -sN https://boloku.web.id/api/v1/events | head -c 300           # SSE harus langsung mengalir, tidak tertahan
```

Kalau SSE baru muncul setelah lama/sekaligus, ada buffering di jalur tunnel/edge:
matikan buffering di edge (nginx edge: `proxy_buffering off;`, Cloudflare: nonaktifkan
"Rocket Loader"/buffering untuk path `/api/v1/events`). PWA otomatis jatuh ke
polling 5 detik bila SSE gagal, jadi status tetap update.
