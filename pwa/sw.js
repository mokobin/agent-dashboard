/* BOLO HQ service worker — app shell cache + last status snapshot. */
const VERSION = "bolo-hq-v1.0.0";
const SHELL = `${VERSION}-shell`;
const API_CACHE = `${VERSION}-api`;
const SHELL_FILES = [
  "/", "/index.html", "/styles.css", "/app.js", "/scene.js", "/manifest.json",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", "/icons/apple-touch-icon.png",
];
const SNAPSHOT_PATHS = ["/api/v1/status", "/api/v1/feed", "/api/v1/commands"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function markCached(resp) {
  const h = new Headers(resp.headers);
  h.set("X-From-Cache", "1");
  return new Response(await resp.blob(), { status: resp.status, statusText: resp.statusText, headers: h });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Live stream: never touch.
  if (url.pathname.startsWith("/api/v1/events")) return;

  // Snapshot endpoints: network-first, fall back to last good copy (flagged X-From-Cache).
  if (SNAPSHOT_PATHS.some((p) => url.pathname === p)) {
    const key = url.pathname; // ignore query so fallback always finds something
    e.respondWith(
      fetch(req).then((resp) => {
        if (resp.ok) { const copy = resp.clone(); caches.open(API_CACHE).then((c) => c.put(key, copy)); }
        return resp;
      }).catch(async () => {
        const hit = await caches.match(key, { cacheName: API_CACHE });
        return hit ? markCached(hit) : new Response(JSON.stringify({ error: "offline" }), { status: 503, headers: { "Content-Type": "application/json" } });
      })
    );
    return;
  }
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: network-first so updates land fast, offline -> cached shell.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then((resp) => { const copy = resp.clone(); caches.open(SHELL).then((c) => c.put("/index.html", copy)); return resp; })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((resp) => {
        if (resp.ok) { const copy = resp.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
        return resp;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
