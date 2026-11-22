/* BOLO HQ — PWA client. Talks to the Sync API (snapshot + SSE, 5s polling fallback). */
(function () {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const esc = OfficeScene.esc;

  // Fallback registry (used only until the first snapshot arrives, and for SIMULASI mode).
  const DEFAULT_AGENTS = [
    { agent_id: "bolo_airdrop", name: "Bolo_airdrop", platform: "hermes", role: "Airdrop hunter", color: "#f59e0b", desk: 0 },
    { agent_id: "bolongonten", name: "Bolongonten", platform: "hermes", role: "Content producer", color: "#ec4899", desk: 1 },
    { agent_id: "hunter-2", name: "Hunter-2", alias: "Nanika", platform: "hermes", role: "Hunter", color: "#22d3ee", desk: 2 },
    { agent_id: "mas-wowo", name: "Mas Wowo", platform: "muse", role: "Operator", color: "#a78bfa", desk: 3 },
    { agent_id: "mas-wiwi", name: "Mas Wiwi", platform: "muse", role: "Asisten utama", color: "#34d399", desk: 4 },
  ];
  const LS = { snap: "bolo.snapshot.v1", admin: "bolo.admin", api: "bolo.api", demo: "bolo.demo" };
  const ls = {
    get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  const qs = new URLSearchParams(location.search);
  const API = (qs.get("api") || ls.get(LS.api) || "/api/v1").replace(/\/$/, "");
  const FORCE_DEMO = qs.get("demo") === "1" || ls.get(LS.demo) === true;

  const state = {
    agents: new Map(), order: [], feed: [], commands: [],
    mode: "connecting",       // live | polling | cache | sim | connecting
    hasRealData: false, lastSync: 0, savedAt: 0, offlineAfter: 60, skew: 0, version: null,
    es: null, pollTimer: null, retryTimer: null, simTimer: null, sceneKey: "",
  };

  // ---------------------------------------------------------------- time helpers
  const fmtWIB = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const fmtWIBshort = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false });
  const fmtDate = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", weekday: "short", day: "numeric", month: "short" });
  const fmtFull = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const serverNow = () => Date.now() + state.skew;
  const parseTs = (s) => (s ? Date.parse(s) : NaN);
  function ago(ms) {
    if (!isFinite(ms)) return "—";
    const s = Math.max(0, Math.round((serverNow() - ms) / 1000));
    if (s < 5) return "baru saja";
    if (s < 60) return `${s} dtk lalu`;
    if (s < 3600) return `${Math.floor(s / 60)} mnt lalu`;
    if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
    return fmtFull.format(ms) + " WIB";
  }
  function dur(ms) {
    const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(x).padStart(2, "0");
  }

  // ---------------------------------------------------------------- derived agent state
  function derive(a) {
    if (state.mode === "sim") return a;
    const seen = parseTs(a.last_seen);
    const fresh = isFinite(seen) && serverNow() - seen <= state.offlineAfter * 1000;
    const rep = a.reported_status || a.status || "offline";
    const online = fresh && rep !== "offline";
    return Object.assign({}, a, { online, status: online ? rep : "offline" });
  }

  function bubbleText(a) {
    const sim = state.mode === "sim" ? "SIMULASI · " : "";
    if (a.status === "working") return sim + (a.task || "Sedang bekerja…") + (a.progress != null ? ` · ${Math.round(a.progress)}%` : "");
    if (a.status === "idle") return sim + (a.task ? `Idle — ${a.task}` : "Idle, menunggu tugas");
    const seen = parseTs(a.last_seen);
    return sim + (isFinite(seen) ? `Offline · terakhir terlihat ${ago(seen)}` : "Offline · belum pernah lapor");
  }

  // ---------------------------------------------------------------- rendering
  function ensureScene() {
    const list = state.order.map((id) => state.agents.get(id));
    const key = list.map((a) => a.agent_id + a.color + a.desk).join("|");
    if (key === state.sceneKey) return;
    state.sceneKey = key;
    OfficeScene.build($("#scene"), list);
    const sc = $("#scene-scroll");
    sc.scrollLeft = (sc.scrollWidth - sc.clientWidth) / 2;
    renderTargets(list);
  }

  function renderAll() {
    ensureScene();
    renderAgents();
    renderFeed();
    renderQueue();
    renderMode();
  }

  function renderAgents() {
    const list = state.order.map((id) => derive(state.agents.get(id)));
    const counts = { working: 0, idle: 0, offline: 0 };
    list.forEach((a) => { counts[a.status] = (counts[a.status] || 0) + 1; OfficeScene.update(a, bubbleText(a)); });
    $("#stats").innerHTML = `<span>🟢 ${counts.working} bekerja</span><span>🟡 ${counts.idle} idle</span><span>⚫ ${counts.offline} offline</span>`;

    const groups = {};
    list.forEach((a) => (groups[a.platform || "lain"] ||= []).push(a));
    $("#agent-groups").innerHTML = Object.entries(groups).map(([p, arr]) => `
      <div class="group">
        <div class="group-h"><span class="pill ${esc(p)}">${esc(p.toUpperCase())}</span>${arr.filter((a) => a.online).length}/${arr.length} online</div>
        ${arr.map(agentCard).join("")}
      </div>`).join("");
  }

  function agentCard(a) {
    const seen = parseTs(a.last_seen), started = parseTs(a.task_started);
    const timer = a.online && isFinite(started) ? `⏱ ${dur(serverNow() - started)}` : "";
    const initials = a.name.replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    const task = a.status === "offline" ? (a.task ? `Terakhir: ${a.task}` : "—") : a.task || (a.status === "idle" ? "Menunggu tugas" : "Bekerja…");
    return `<div class="agent status-${a.status}" data-agent="${esc(a.agent_id)}" role="button" tabindex="0">
      <div class="avatar" style="background:${esc(a.color || "#60a5fa")}">${esc(initials)}</div>
      <div class="a-main">
        <div class="a-name">${esc(a.name)}${a.alias ? ` <small>(${esc(a.alias)})</small>` : ""}</div>
        <div class="a-task" title="${esc(task)}">${esc(task)}</div>
        <div class="a-meta">${timer ? `<span>${timer}</span>` : ""}<span>${isFinite(seen) ? "dilihat " + ago(seen) : "belum pernah lapor"}</span></div>
        ${a.progress != null && a.online ? `<div class="bar"><i style="width:${Math.max(0, Math.min(100, a.progress))}%"></i></div>` : ""}
      </div>
      <span class="chip ${a.status}">${a.status === "working" ? "bekerja" : a.status}</span>
    </div>`;
  }

  function nameOf(id) { const a = state.agents.get(id); return a ? a.name : id || "Sistem"; }

  function renderFeed() {
    const el = $("#feed");
    if (!state.feed.length) { el.innerHTML = `<li class="empty">Belum ada aktivitas.</li>`; return; }
    el.innerHTML = state.feed.slice(0, 60).map((f) => {
      const t = parseTs(f.ts);
      return `<li class="k-${esc(f.kind)}"><time title="${isFinite(t) ? fmtFull.format(t) : ""}">${isFinite(t) ? fmtWIBshort.format(t) : "--:--"}</time><span>${esc(f.text)}</span></li>`;
    }).join("");
  }

  function renderQueue() {
    const el = $("#queue");
    const open = state.commands.slice(0, 40);
    if (!open.length) { el.innerHTML = `<li class="empty">Antrean kosong.</li>`; return; }
    el.innerHTML = open.map((c) => {
      const t = parseTs(c.created);
      return `<li><div class="li-top"><span>→ ${esc(c.target === "all" ? "Semua agent" : nameOf(c.target))} · ${isFinite(t) ? ago(t) : ""}</span><span class="chip ${esc(c.state)}">${esc(c.state)}</span></div>${esc(c.text)}${c.note ? `<div class="muted">↳ ${esc(c.note)}</div>` : ""}</li>`;
    }).join("");
  }

  function renderTargets(list) {
    const sel = $("#cmd-target"), cur = sel.value;
    sel.innerHTML = `<option value="all">📣 Semua agent</option>` + list.map((a) => `<option value="${esc(a.agent_id)}">${esc(a.name)} · ${esc((a.platform || "").toUpperCase())}</option>`).join("");
    if (cur) sel.value = cur;
  }

  const MODE_LABEL = { live: "LIVE", polling: "POLLING", cache: "DATA TERAKHIR", sim: "SIMULASI", connecting: "MENGHUBUNGKAN" };
  function renderMode() {
    const c = $("#conn");
    c.className = "conn mode-" + state.mode;
    $("#conn-label").textContent = MODE_LABEL[state.mode];
    $(".sim-watermark").hidden = state.mode !== "sim";
    const b = $("#banner");
    if (state.mode === "sim") {
      b.hidden = false; b.className = "banner sim";
      b.innerHTML = `<b>SIMULASI</b> — Sync API belum tersambung${FORCE_DEMO ? " (mode demo aktif)" : ""}. Status &amp; tugas di bawah ini <b>bukan</b> status asli agent.`;
    } else if (state.mode === "cache") {
      b.hidden = false; b.className = "banner cache";
      b.innerHTML = `Tidak terhubung ke server — menampilkan <b>data terakhir ${state.savedAt ? fmtFull.format(state.savedAt) + " WIB" : ""}</b>. Mencoba lagi otomatis…`;
    } else b.hidden = true;
    const ls_ = state.lastSync ? `Sinkron terakhir: ${fmtFull.format(state.lastSync)} WIB (${ago(state.lastSync)})` : "Belum pernah sinkron";
    $("#last-sync").textContent = state.mode === "sim" ? "Mode SIMULASI — tidak ada data asli" : ls_;
    const dis = state.mode === "sim";
    $("#cmd-send").disabled = dis;
    $("#cmd-hint").textContent = dis ? "Pusat Perintah nonaktif saat SIMULASI." : "Perintah masuk antrean. Eksekusi oleh agent = fase berikutnya.";
    if (state.version) $("#ver").textContent = state.version;
  }

  // ---------------------------------------------------------------- data in
  function setAgents(list) {
    list.forEach((a) => state.agents.set(a.agent_id, Object.assign({}, state.agents.get(a.agent_id) || {}, a)));
    const ids = list.map((a) => a.agent_id);
    state.order = [...ids, ...state.order.filter((id) => !ids.includes(id))];
  }

  function applySnapshot(snap, { feed, commands } = {}) {
    if (!snap || !Array.isArray(snap.agents)) return;
    const st = parseTs(snap.server_time);
    if (isFinite(st)) state.skew = st - Date.now();
    state.offlineAfter = snap.offline_after || 60;
    state.version = snap.version || state.version;
    state.agents.clear(); state.order = [];
    setAgents(snap.agents);
    if (feed) state.feed = feed;
    if (commands) state.commands = commands;
    state.hasRealData = true;
    state.lastSync = Date.now();
    persist();
  }

  let persistT = null;
  function persist() {
    clearTimeout(persistT);
    persistT = setTimeout(() => {
      state.savedAt = Date.now();
      ls.set(LS.snap, {
        savedAt: state.savedAt, skew: state.skew, offlineAfter: state.offlineAfter, version: state.version,
        agents: state.order.map((id) => state.agents.get(id)), feed: state.feed.slice(0, 60), commands: state.commands.slice(0, 40),
      });
    }, 400);
  }

  function upsertCommand(c) {
    const i = state.commands.findIndex((x) => x.id === c.id);
    if (i >= 0) state.commands[i] = c; else state.commands.unshift(c);
  }

  async function fetchJSON(path, { method = "GET", body, token, timeout = 6000 } = {}) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(API + path, {
        method, signal: ctl.signal, cache: "no-store",
        headers: Object.assign({ "Content-Type": "application/json" }, token ? { Authorization: "Bearer " + token } : {}),
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { const e = new Error(data.error || "HTTP " + r.status); e.status = r.status; throw e; }
      if (r.headers.get("X-From-Cache") === "1") { const e = new Error("offline cache"); e.cached = true; throw e; }
      return data;
    } finally { clearTimeout(t); }
  }

  async function pullAll() {
    const [snap, feed, cmds] = await Promise.all([fetchJSON("/status"), fetchJSON("/feed?limit=60"), fetchJSON("/commands?limit=40")]);
    applySnapshot(snap, { feed: feed.feed, commands: cmds.commands });
  }

  async function connect() {
    clearTimeout(state.retryTimer);
    if (FORCE_DEMO) return startSim();
    try {
      await pullAll();
      stopSim();
      setMode("polling");
      openSSE();
      renderAll();
    } catch (e) {
      if (!state.hasRealData) startSim();
      else setMode("cache");
      state.retryTimer = setTimeout(connect, 5000);
    }
  }

  function setMode(m) { if (state.mode !== m) { state.mode = m; renderMode(); renderAgents(); } }

  function openSSE() {
    if (!("EventSource" in window)) return startPolling();
    if (state.es) state.es.close();
    const es = new EventSource(API + "/events");
    state.es = es;
    es.addEventListener("snapshot", (ev) => {
      const d = JSON.parse(ev.data);
      applySnapshot(d.snapshot, { feed: d.feed, commands: d.commands });
      stopPolling(); setMode("live"); renderAll();
    });
    es.addEventListener("agent", (ev) => {
      const a = JSON.parse(ev.data);
      setAgents([a]); state.lastSync = Date.now(); persist();
      renderAgents();
      const b = document.getElementById("bub-" + a.agent_id);
      if (b) { b.classList.remove("flash"); void b.offsetWidth; b.classList.add("flash"); }
    });
    es.addEventListener("feed", (ev) => { state.feed.unshift(JSON.parse(ev.data)); state.feed.length = Math.min(state.feed.length, 200); persist(); renderFeed(); });
    es.addEventListener("command", (ev) => { upsertCommand(JSON.parse(ev.data)); persist(); renderQueue(); });
    es.addEventListener("ping", (ev) => {
      const st = parseTs(JSON.parse(ev.data).server_time);
      if (isFinite(st)) state.skew = st - Date.now();
      state.lastSync = Date.now();
    });
    es.onerror = () => { if (state.mode === "live") setMode("polling"); startPolling(); };
  }

  function startPolling() {
    if (state.pollTimer) return;
    state.pollTimer = setInterval(async () => {
      try { await pullAll(); if (state.mode !== "live") setMode("polling"); renderAll(); }
      catch { setMode("cache"); }
    }, 5000);
  }
  function stopPolling() { clearInterval(state.pollTimer); state.pollTimer = null; }

  // ---------------------------------------------------------------- SIMULASI (clearly labelled, never presented as real)
  const SIM_TASKS = {
    "bolo_airdrop": ["Scan airdrop baru di 14 chain", "Cek eligibility wallet #3", "Isi form whitelist", "Rekap poin quest mingguan"],
    "bolongonten": ["Draft caption konten harian", "Render thumbnail 3 varian", "Jadwalkan posting jam 19:00", "Riset tren mingguan"],
    "hunter-2": ["Berburu peluang baru", "Verifikasi link resmi proyek", "Pantau channel pengumuman", "Kumpulkan laporan"],
    "mas-wowo": ["Upload video recap ke YouTube", "Cek antrean render", "Balas komentar channel", "Backup naskah"],
    "mas-wiwi": ["Susun naskah recap chapter 120", "Koordinasi tugas agent", "Ringkas laporan harian", "Siapkan SETUP proyek baru"],
  };
  function startSim() {
    if (state.mode === "sim" && state.simTimer) return;
    if (!state.order.length) setAgents(DEFAULT_AGENTS);
    state.mode = "sim";
    const now = new Date().toISOString();
    state.order.forEach((id, i) => {
      const a = state.agents.get(id), tasks = SIM_TASKS[id] || ["Tugas contoh"];
      Object.assign(a, { status: i === 3 ? "offline" : i % 2 ? "idle" : "working", online: i !== 3, task: tasks[0], progress: i % 2 ? null : 20 + i * 15,
        last_seen: i === 3 ? new Date(Date.now() - 7 * 60000).toISOString() : now, task_started: new Date(Date.now() - (i + 1) * 97000).toISOString() });
    });
    state.feed = [{ ts: now, kind: "sim", text: "[SIMULASI] Data contoh — Sync API belum tersambung." }];
    state.commands = [];
    renderAll();
    clearInterval(state.simTimer);
    state.simTimer = setInterval(() => {
      const id = state.order[Math.floor(Math.random() * state.order.length)], a = state.agents.get(id), tasks = SIM_TASKS[id] || ["Tugas contoh"];
      const r = Math.random(), t = new Date().toISOString();
      if (r < 0.15) Object.assign(a, { status: "offline", online: false });
      else if (r < 0.4) Object.assign(a, { status: "idle", online: true, progress: null, last_seen: t, task_started: t });
      else Object.assign(a, { status: "working", online: true, task: tasks[Math.floor(Math.random() * tasks.length)], progress: Math.floor(Math.random() * 90) + 5, last_seen: t, task_started: t });
      state.feed.unshift({ ts: t, kind: "sim", text: `[SIMULASI] ${a.name} → ${a.status}${a.status === "working" ? ": " + a.task : ""}` });
      state.feed.length = Math.min(state.feed.length, 40);
      renderAgents(); renderFeed();
    }, 4500);
  }
  function stopSim() {
    if (!state.simTimer && state.mode !== "sim") return;
    clearInterval(state.simTimer); state.simTimer = null;
    if (state.mode === "sim") state.mode = "connecting";
  }

  // ---------------------------------------------------------------- UI events
  function openAgent(id) {
    const a = derive(state.agents.get(id)); if (!a) return;
    const seen = parseTs(a.last_seen), started = parseTs(a.task_started);
    $("#sheet-body").innerHTML = `
      <h2>${esc(a.name)} ${a.alias ? `<small class="muted">(${esc(a.alias)})</small>` : ""}</h2>
      <span class="chip ${a.status}">${a.status}</span> <span class="pill ${esc(a.platform)}" style="padding:2px 8px;border-radius:6px;color:#0b1024;font-weight:800;font-size:11px">${esc((a.platform || "").toUpperCase())}</span>
      ${state.mode === "sim" ? ` <span class="chip failed">SIMULASI</span>` : ""}
      <dl>
        <dt>Peran</dt><dd>${esc(a.role || "—")}</dd>
        <dt>Tugas</dt><dd>${esc(a.task || "—")}</dd>
        <dt>Detail</dt><dd>${a.detail ? `<pre>${esc(a.detail)}</pre>` : "—"}</dd>
        <dt>Progress</dt><dd>${a.progress != null ? Math.round(a.progress) + "%" : "—"}</dd>
        <dt>Sesi tugas</dt><dd>${a.online && isFinite(started) ? dur(serverNow() - started) + " (mulai " + fmtFull.format(started) + ")" : "—"}</dd>
        <dt>Terakhir terlihat</dt><dd>${isFinite(seen) ? fmtFull.format(seen) + " WIB · " + ago(seen) : "belum pernah lapor"}</dd>
        <dt>Agent ID</dt><dd><code>${esc(a.agent_id)}</code></dd>
      </dl>
      <div class="row between" style="margin-top:14px"><span></span><button class="btn" id="sheet-cmd" ${state.mode === "sim" ? "disabled" : ""}>Kirim perintah ke ${esc(a.name)}</button></div>`;
    $("#sheet").showModal();
    $("#sheet-cmd").onclick = () => { $("#sheet").close(); $("#cmd-target").value = id; $("#cmd-text").focus(); $("#panel-command").scrollIntoView({ behavior: "smooth", block: "center" }); };
  }

  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2600);
  }

  document.addEventListener("click", (e) => {
    const bub = e.target.closest(".bubble");
    if (bub) {
      if (bub.classList.contains("open")) openAgent(bub.dataset.agent);
      document.querySelectorAll(".bubble.open").forEach((b) => b !== bub && b.classList.remove("open"));
      bub.classList.toggle("open");
      return;
    }
    const el = e.target.closest(".agent, .desk");
    if (el) return openAgent(el.dataset.agent);
    document.querySelectorAll(".bubble.open").forEach((b) => b.classList.remove("open"));
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.classList?.contains("agent")) openAgent(e.target.dataset.agent); });

  $("#cmd-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("#cmd-text").value.trim(), target = $("#cmd-target").value;
    if (!text) return toast("Tulis perintahnya dulu.");
    const token = ls.get(LS.admin);
    if (!token) { toast("Isi admin token dulu di Pengaturan."); return openSettings(); }
    $("#cmd-send").disabled = true;
    try {
      const r = await fetchJSON("/commands", { method: "POST", body: { target, text }, token });
      upsertCommand(r.command); renderQueue();
      $("#cmd-text").value = ""; toast("Perintah masuk antrean ✓");
    } catch (err) {
      if (err.status === 401) { toast("Admin token salah."); openSettings(); }
      else toast("Gagal kirim: " + err.message);
    } finally { $("#cmd-send").disabled = state.mode === "sim"; }
  });

  function openSettings() {
    $("#set-admin").value = ls.get(LS.admin) || "";
    $("#set-api").value = ls.get(LS.api) || "";
    $("#set-demo").checked = ls.get(LS.demo) === true;
    $("#settings").showModal();
  }
  $("#btn-settings").onclick = openSettings;
  $("#conn").onclick = () => toast(state.mode === "live" ? "Tersambung live (SSE)." : state.mode === "polling" ? "Live stream putus — polling tiap 5 dtk." : state.mode === "cache" ? "Offline — data terakhir dari cache." : state.mode === "sim" ? "SIMULASI — bukan data asli." : "Menghubungkan…");
  $("#set-save").onclick = () => {
    const tok = $("#set-admin").value.trim(), api = $("#set-api").value.trim(), demo = $("#set-demo").checked;
    tok ? ls.set(LS.admin, tok) : ls.del(LS.admin);
    api ? ls.set(LS.api, api) : ls.del(LS.api);
    demo ? ls.set(LS.demo, true) : ls.del(LS.demo);
    $("#settings").close(); toast("Tersimpan — memuat ulang…"); setTimeout(() => location.reload(), 600);
  };
  $("#set-clear").onclick = async () => {
    ls.del(LS.snap);
    if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
    toast("Cache dihapus."); setTimeout(() => location.reload(), 600);
  };

  // install prompt
  let deferred = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; $("#btn-install").hidden = false; });
  $("#btn-install").onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $("#btn-install").hidden = true; };
  window.addEventListener("appinstalled", () => toast("BOLO HQ ter-install ✓"));

  window.addEventListener("online", () => connect());
  window.addEventListener("offline", () => { if (state.hasRealData) setMode("cache"); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && state.mode !== "live" && !FORCE_DEMO) connect(); });

  // ---------------------------------------------------------------- tick
  function tick() {
    const now = new Date(serverNow());
    $("#clock-time").textContent = fmtWIB.format(now);
    $("#clock-date").textContent = fmtDate.format(now) + " · WIB";
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "numeric", minute: "numeric", second: "numeric", hour12: false })
      .formatToParts(now).map((p) => [p.type, +p.value]));
    OfficeScene.setClock(parts.hour, parts.minute, parts.second);
    if (state.order.length) renderAgents();
    if (state.mode !== "sim") $("#last-sync").textContent = state.lastSync ? `Sinkron terakhir: ${fmtFull.format(state.lastSync)} WIB (${ago(state.lastSync)})` : "Belum pernah sinkron";
  }

  // ---------------------------------------------------------------- boot
  function boot() {
    const cached = ls.get(LS.snap);
    if (cached && Array.isArray(cached.agents) && cached.agents.length && !FORCE_DEMO) {
      setAgents(cached.agents);
      state.feed = cached.feed || []; state.commands = cached.commands || [];
      state.savedAt = cached.savedAt; state.lastSync = cached.savedAt; state.skew = cached.skew || 0;
      state.offlineAfter = cached.offlineAfter || 60; state.version = cached.version;
      state.hasRealData = true; state.mode = "cache";
    } else setAgents(DEFAULT_AGENTS);
    renderAll();
    tick(); setInterval(tick, 1000);
    connect();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
  boot();
})();
