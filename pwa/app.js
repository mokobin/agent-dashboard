/* BOLO HQ — Pusat Kendali Agent (PWA client).
 * UI ported from docs/prototype.html; data comes from the Sync API
 * (snapshot + SSE, 5s polling fallback, offline cache). SIMULASI only when the API was never reachable. */
(function () {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const esc = OfficeScene.esc;

  // Fallback registry — used until the first snapshot arrives and for SIMULASI mode.
  const DEFAULT_AGENTS = [
    { agent_id: "bolo_airdrop", name: "Bolo_airdrop", platform: "hermes", role: "Airdrop Hunter", color: "#0d9488", initials: "BA", shirt: "#2a9d8f", skin: "#8d5524", hair: "#14100c", desk: 0 },
    { agent_id: "bolongonten", name: "Bolongonten", platform: "hermes", role: "Content Creator", color: "#059669", initials: "BK", shirt: "#3f7d4e", skin: "#c68642", hair: "#241611", desk: 1 },
    { agent_id: "hunter-2", name: "Hunter-2", alias: "Nanika", platform: "hermes", role: "Bug Hunter", color: "#2563eb", initials: "H2", shirt: "#33546d", skin: "#6b4423", hair: "#0d0d0f", desk: 2 },
    { agent_id: "mas-wowo", name: "Mas Wowo", platform: "muse", role: "Agent Operasional", color: "#b45309", initials: "MW", shirt: "#7d3b3b", skin: "#a0662f", hair: "#191007", desk: 3 },
    { agent_id: "mas-wiwi", name: "Mas Wiwi", platform: "muse", role: "Koordinator", color: "#e8590c", initials: "WW", shirt: "#c2571b", skin: "#8d5524", hair: "#120d08", desk: 4 },
  ];
  const PLATFORMS = [["hermes", "Hermes", "#0d9488"], ["muse", "Muse", "#d97706"]];
  const QUICK = [
    { label: "Cek status semua agent", target: "all", text: "Laporkan status & progres tugas saat ini" },
    { label: "Mulai sesi hunting", target: "hunter-2", text: "Mulai sesi hunting: pilih target baru dan petakan permukaannya" },
    { label: "Render konten berikutnya", target: "bolongonten", text: "Render video berikutnya dari antrean konten" },
    { label: "Sapu klaim airdrop", target: "bolo_airdrop", text: "Sapu semua wallet: klaim airdrop yang sudah terbuka" },
    { label: "Siapkan ringkasan harian", target: "mas-wiwi", text: "Siapkan ringkasan aktivitas semua agent hari ini" },
  ];
  const ST_LABEL = { working: "Bekerja", idle: "Idle", offline: "Offline" };
  const Q_LABEL = { queued: "antre", received: "diterima", running: "berjalan", done: "selesai", failed: "gagal" };

  const LS = { snap: "bolo.snapshot.v2", admin: "bolo.admin", api: "bolo.api", demo: "bolo.demo" };
  const ls = {
    get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  const qs = new URLSearchParams(location.search);
  const API = (qs.get("api") || ls.get(LS.api) || "/api/v1").replace(/\/$/, "");
  const FORCE_DEMO = qs.get("demo") === "1" || ls.get(LS.demo) === true;

  const state = {
    agents: new Map(), order: [], feed: [], commands: [], selected: null,
    mode: "connecting", hasRealData: false, lastSync: 0, savedAt: 0, offlineAfter: 60, skew: 0, version: null,
    es: null, pollTimer: null, retryTimer: null, simTimer: null, uiKey: "", detailSig: "",
  };

  // ---------------------------------------------------------------- time
  const TZ = "Asia/Jakarta";
  const fHMS = new Intl.DateTimeFormat("id-ID", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const fLong = new Intl.DateTimeFormat("id-ID", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const fShort = new Intl.DateTimeFormat("id-ID", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
  const fFull = new Intl.DateTimeFormat("id-ID", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const hms = (d) => fHMS.format(d).replace(/\./g, ":");
  const full = (d) => fFull.format(d).replace(/\./g, ":");
  const serverNow = () => Date.now() + state.skew;
  const parseTs = (s) => (s ? Date.parse(s) : NaN);
  function ago(ms) {
    if (!isFinite(ms)) return "—";
    const s = Math.max(0, Math.round((serverNow() - ms) / 1000));
    if (s < 5) return "baru saja";
    if (s < 60) return `${s} dtk lalu`;
    if (s < 3600) return `${Math.floor(s / 60)} mnt lalu`;
    if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
    return full(ms) + " WIB";
  }
  function fmtSess(ms) {
    const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ":" : "") + String(m).padStart(2, "0") + ":" + String(x).padStart(2, "0");
  }

  // ---------------------------------------------------------------- derived state
  function derive(a) {
    if (!a) return a;
    if (state.mode === "sim") return a;
    const seen = parseTs(a.last_seen);
    const fresh = isFinite(seen) && serverNow() - seen <= state.offlineAfter * 1000;
    const rep = a.reported_status || a.status || "offline";
    const online = fresh && rep !== "offline";
    return Object.assign({}, a, { online, status: online ? rep : "offline" });
  }
  const list = () => state.order.map((id) => derive(state.agents.get(id)));
  const nameOf = (id) => (state.agents.get(id) || {}).name || id;
  const colorOf = (id) => (state.agents.get(id) || {}).color || "#94a3b8";
  const sessMs = (a) => { const t = parseTs(a.task_started); return a.online && isFinite(t) ? serverNow() - t : null; };

  function taskLine(a) {
    if (a.status === "offline") {
      const seen = parseTs(a.last_seen);
      return isFinite(seen) ? `Offline · terakhir terlihat ${ago(seen)}` : "Offline · belum pernah lapor";
    }
    if (a.status === "idle") return a.task ? `Idle — ${a.task}` : "Idle, menunggu perintah berikutnya";
    return a.task || "Sedang bekerja…";
  }

  // ---------------------------------------------------------------- build (once per agent set)
  function ensureUI() {
    const agents = list();
    const key = agents.map((a) => [a.agent_id, a.name, a.color, a.desk, a.platform].join(":")).join("|");
    if (key === state.uiKey) return;
    state.uiKey = key;
    if (!state.selected || !state.agents.has(state.selected)) state.selected = state.agents.has("mas-wiwi") ? "mas-wiwi" : state.order[0];

    OfficeScene.build($("#sceneWrap"), agents, selectAgent);

    const L = $("#agentList");
    L.innerHTML = "";
    const known = PLATFORMS.map((p) => p[0]);
    const plats = PLATFORMS.concat([...new Set(agents.map((a) => a.platform).filter((p) => !known.includes(p)))].map((p) => [p, p, "#64748b"]));
    plats.forEach(([pid, pname, pcolor]) => {
      const group = agents.filter((a) => a.platform === pid);
      if (!group.length) return;
      L.insertAdjacentHTML("beforeend", `<div class="group-label"><span class="gdot" style="background:${pcolor}"></span>Platform ${esc(pname)}</div>`);
      group.forEach((a) => {
        L.insertAdjacentHTML("beforeend", `
          <div class="agent-row" id="row-${esc(a.agent_id)}" data-agent="${esc(a.agent_id)}" role="button" tabindex="0">
            <div class="avatar" style="background:${esc(a.color)}">${esc(a.initials || a.name.slice(0, 2).toUpperCase())}</div>
            <div><div class="nm">${esc(a.name)}<span class="plat ${esc(a.platform)}">${esc(pname)}</span></div>
              <div class="task" id="task-${esc(a.agent_id)}"></div>
              <div class="pbar"><i id="bar-${esc(a.agent_id)}"></i></div></div>
            <div class="row-side"><span class="status-pill offline" id="pill-${esc(a.agent_id)}">Offline</span>
              <div class="sess mono" id="sess-${esc(a.agent_id)}">--:--</div></div>
          </div>`);
      });
    });
    L.querySelectorAll(".agent-row").forEach((r) => {
      r.addEventListener("click", () => selectAgent(r.dataset.agent));
      r.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectAgent(r.dataset.agent); } });
    });

    const sel = $("#cmdTarget"), cur = sel.value;
    sel.innerHTML = `<option value="all">Semua Agent</option>` + agents.map((a) => `<option value="${esc(a.agent_id)}">${esc(a.name)}</option>`).join("");
    if (cur) sel.value = cur;

    const Q = $("#quickCmds");
    Q.innerHTML = "";
    QUICK.filter((q) => q.target === "all" || state.agents.has(q.target)).forEach((q) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = q.label;
      b.addEventListener("click", () => sendCommand(q.target, q.text));
      Q.appendChild(b);
    });
    state.detailSig = "";
  }

  // ---------------------------------------------------------------- render
  function renderAll() { ensureUI(); renderAgents(); renderFeed(); renderQueue(); renderMode(); }

  function renderAgents() {
    const agents = list();
    let working = 0, idle = 0, offline = 0, online = 0, done = 0;
    agents.forEach((a) => {
      if (a.status === "working") working++; else if (a.status === "idle") idle++; else offline++;
      if (a.online) online++;
      done += a.done_today || 0;
      const id = a.agent_id;
      OfficeScene.update(a, id === state.selected);
      const row = document.getElementById("row-" + id);
      if (!row) return;
      row.classList.toggle("selected", id === state.selected);
      row.classList.toggle("offline", a.status === "offline");
      const t = document.getElementById("task-" + id);
      t.textContent = a.status === "offline" ? (a.task ? "Terakhir: " + a.task : taskLine(a)) : a.status === "idle" ? (a.task || "Menunggu perintah") : (a.task || "Sedang bekerja…");
      t.classList.toggle("muted", a.status === "offline");
      const bar = document.getElementById("bar-" + id);
      bar.style.width = (a.progress != null && a.status !== "offline" ? Math.max(0, Math.min(100, a.progress)) : a.status === "working" ? 8 : 0) + "%";
      bar.className = a.status === "working" ? "" : a.status;
      const pill = document.getElementById("pill-" + id);
      pill.className = "status-pill " + a.status; pill.textContent = ST_LABEL[a.status];
      const ms = sessMs(a);
      const seen = parseTs(a.last_seen);
      document.getElementById("sess-" + id).textContent = ms != null ? fmtSess(ms) : isFinite(seen) ? ago(seen) : "--:--";
    });
    const total = agents.length;
    $("#statOnline").textContent = `${online}/${total}`;
    $("#statRunning").textContent = working;
    $("#statDone").textContent = state.mode === "sim" ? (state.simDone || 0) : done;
    $("#ctrlTag").textContent = `${working} bekerja · ${idle} idle · ${offline} offline`;
    renderDetail();
    renderBubble();
  }

  function renderBubble() {
    const a = derive(state.agents.get(state.selected));
    const b = $("#bubble");
    if (!a) { b.hidden = true; return; }
    b.hidden = false;
    const p = OfficeScene.chipPos(a.agent_id);
    b.style.left = Math.min(84, Math.max(15, p.left)) + "%";
    b.style.top = p.top + "%";
    $("#bubbleName").textContent = a.name + (a.status !== "working" ? " · " + ST_LABEL[a.status] : "");
    $("#bubbleName").style.color = a.color;
    $("#bubbleText").textContent = (state.mode === "sim" ? "SIMULASI · " : "") + taskLine(a) + (a.status === "working" && a.progress != null ? ` · ${Math.round(a.progress)}%` : "");
    $("#bubbleDots").style.display = a.status === "working" ? "inline-flex" : "none";
  }

  function renderDetail() {
    const a = derive(state.agents.get(state.selected));
    const D = $("#detailCard");
    if (!a) { D.innerHTML = ""; return; }
    const sim = state.mode === "sim";
    const sig = JSON.stringify([a.agent_id, a.status, a.task, a.detail, a.role, a.platform, sim, state.mode]);
    const plat = (PLATFORMS.find((p) => p[0] === a.platform) || [0, a.platform])[1];
    if (sig !== state.detailSig) {
      state.detailSig = sig;
      D.innerHTML = `
        <h3>${esc(a.name)}${a.alias ? ` <span class="role">(${esc(a.alias)})</span>` : ""}</h3>
        <div class="role">${esc(a.role || "Agent")} · Platform ${esc(plat)}</div>
        <div class="cur"><span class="lbl">${a.status === "offline" ? "Tugas terakhir" : "Tugas saat ini"}</span><span id="detailTask"></span>${a.detail ? `<pre>${esc(a.detail)}</pre>` : ""}</div>
        <div class="meta"><span>Progres <b id="detailProg">—</b></span><span>Sesi <b id="detailSess">--:--</b></span><span>Selesai <b id="detailDone">0 tugas</b></span></div>
        <div class="meta2" id="detailSeen"></div>
        <div class="btn-row">
          <button class="btn" id="btnPause" type="button" ${sim || a.status === "offline" ? "disabled" : ""}>Jeda</button>
          <button class="btn" id="btnDone" type="button" ${sim || a.status === "offline" ? "disabled" : ""}>Selesaikan Tugas</button>
          <button class="btn primary" id="btnCmd" type="button">Beri Perintah</button>
        </div>`;
      $("#btnPause").onclick = () => sendCommand(a.agent_id, "Jeda tugas saat ini dan laporkan status");
      $("#btnDone").onclick = () => sendCommand(a.agent_id, "Selesaikan tugas saat ini lalu laporkan hasilnya");
      $("#btnCmd").onclick = () => { $("#cmdTarget").value = a.agent_id; $("#cmdText").focus(); $("#cmdText").scrollIntoView({ behavior: "smooth", block: "center" }); };
    }
    $("#detailTask").textContent = a.task || (a.status === "idle" ? "Menunggu perintah berikutnya" : "—");
    $("#detailProg").textContent = a.progress != null && a.status !== "offline" ? Math.round(a.progress) + "%" : "—";
    const ms = sessMs(a);
    $("#detailSess").textContent = ms != null ? fmtSess(ms) : "--:--";
    $("#detailDone").textContent = (a.done_today || 0) + " tugas";
    const seen = parseTs(a.last_seen);
    $("#detailSeen").textContent = isFinite(seen) ? `Heartbeat terakhir ${full(seen)} WIB · ${ago(seen)}` : "Belum pernah mengirim heartbeat";
  }

  function renderFeed() {
    const F = $("#feed");
    if (!state.feed.length) { F.innerHTML = `<li><span class="empty">Belum ada aktivitas.</span></li>`; return; }
    F.innerHTML = state.feed.slice(0, 40).map((f) => {
      const t = parseTs(f.ts);
      const who = f.agent_id ? `<b>${esc(nameOf(f.agent_id))}</b> — ` : "";
      const cls = f.kind === "command" ? "cmd-evt" : "k-" + esc(f.kind);
      return `<li><span class="ft">${isFinite(t) ? hms(t) : "--:--:--"}</span><span class="fd" style="background:${f.agent_id ? esc(colorOf(f.agent_id)) : f.kind === "command" ? "var(--accent)" : "#94a3b8"}"></span><span>${who}<span class="${cls}">${esc(f.text)}</span></span></li>`;
    }).join("");
  }

  function renderQueue() {
    const Q = $("#queueList");
    const items = state.commands.slice(0, 8);
    $("#queueEmpty").style.display = items.length ? "none" : "block";
    Q.innerHTML = items.map((c) => {
      const t = parseTs(c.created);
      const who = c.target === "all" ? "Semua Agent" : nameOf(c.target);
      return `<li><span class="q-agent" style="color:${c.target === "all" ? "var(--accent)" : esc(colorOf(c.target))}">${esc(who)}</span><span class="q-text">${esc(c.text)}${c.note ? ` <span class="q-when">↳ ${esc(c.note)}</span>` : ""}</span><span class="q-when">${isFinite(t) ? ago(t) : ""}</span><span class="q-state ${esc(c.state)}">${esc(Q_LABEL[c.state] || c.state)}</span></li>`;
    }).join("");
  }

  const MODE_LABEL = { live: "LIVE", polling: "POLLING", cache: "DATA TERAKHIR", sim: "SIMULASI", connecting: "MENGHUBUNGKAN" };
  function renderMode() {
    $("#conn").className = "live-pill mode-" + state.mode;
    $("#conn-label").textContent = MODE_LABEL[state.mode];
    $("#simMark").hidden = state.mode !== "sim";
    const b = $("#banner");
    if (state.mode === "sim") {
      b.hidden = false; b.className = "banner sim";
      b.innerHTML = `<b>SIMULASI</b> — Sync API belum tersambung${FORCE_DEMO ? " (mode demo aktif)" : ""}. Status &amp; tugas di bawah ini <b>bukan</b> status asli agent.`;
    } else if (state.mode === "cache") {
      b.hidden = false; b.className = "banner cache";
      b.innerHTML = `Tidak terhubung ke server — menampilkan <b>data terakhir ${state.savedAt ? full(state.savedAt) + " WIB" : ""}</b>. Mencoba lagi otomatis…`;
    } else b.hidden = true;
    $("#footNote").textContent = state.mode === "sim"
      ? "Status & aktivitas di halaman ini sedang berjalan sebagai SIMULASI di browser — bukan status asli agent."
      : "Status di halaman ini berasal dari heartbeat asli tiap agent lewat Sync API.";
    $("#feedTag").textContent = state.mode === "sim" ? "Simulasi gerak aktivitas tiap agent" : "Dari heartbeat asli tiap agent";
    $("#cmdTag").textContent = state.mode === "sim" ? "Nonaktif saat SIMULASI" : "Perintah masuk antrean agent";
    $("#cmdSend").disabled = state.mode === "sim";
    $("#quickCmds").querySelectorAll("button").forEach((x) => (x.disabled = state.mode === "sim"));
    state.detailSig = "";
    renderLastSync();
  }
  function renderLastSync() {
    $("#lastSync").textContent = state.mode === "sim" ? "" : state.lastSync ? `Sinkron terakhir ${full(state.lastSync)} WIB (${ago(state.lastSync)})${state.version ? " · v" + state.version : ""}` : "";
  }

  // ---------------------------------------------------------------- selection
  function selectAgent(id) {
    if (!state.agents.has(id)) return;
    state.selected = id;
    state.detailSig = "";
    renderAgents();
    if (window.matchMedia("(max-width: 1080px)").matches && !document.activeElement?.closest?.(".agent-row")) {
      // tapping in the scene on mobile: nothing else to do — the bubble already moved
    }
  }

  // ---------------------------------------------------------------- data in
  function setAgents(arr) {
    arr.forEach((a) => state.agents.set(a.agent_id, Object.assign({}, state.agents.get(a.agent_id) || {}, a)));
    const ids = arr.map((a) => a.agent_id);
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
      ls.set(LS.snap, { savedAt: state.savedAt, skew: state.skew, offlineAfter: state.offlineAfter, version: state.version,
        agents: state.order.map((id) => state.agents.get(id)), feed: state.feed.slice(0, 60), commands: state.commands.slice(0, 40) });
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
      const r = await fetch(API + path, { method, signal: ctl.signal, cache: "no-store",
        headers: Object.assign({ "Content-Type": "application/json" }, token ? { Authorization: "Bearer " + token } : {}),
        body: body ? JSON.stringify(body) : undefined });
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
      state.mode = "polling";
      renderAll();
      openSSE();
    } catch (e) {
      if (!state.hasRealData) startSim(); else setMode("cache");
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
      stopPolling(); state.mode = "live"; renderAll();
    });
    es.addEventListener("agent", (ev) => {
      const a = JSON.parse(ev.data);
      setAgents([a]); state.lastSync = Date.now(); persist();
      if (a.agent_id === state.selected) state.detailSig = "";
      renderAgents();
      const c = document.getElementById("chip-" + a.agent_id);
      if (c) { c.animate([{ transform: "translate(-50%,-100%) scale(1.18)" }, { transform: "translate(-50%,-100%) scale(1)" }], { duration: 600, easing: "ease-out" }); }
    });
    es.addEventListener("feed", (ev) => {
      const f = JSON.parse(ev.data);
      state.feed.unshift(f); state.feed.length = Math.min(state.feed.length, 200);
      if (f.kind === "done" && state.agents.has(f.agent_id)) { const a = state.agents.get(f.agent_id); a.done_today = (a.done_today || 0) + 1; renderAgents(); }
      persist(); renderFeed();
    });
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
      try { await pullAll(); if (state.mode !== "live") state.mode = "polling"; renderAll(); }
      catch { setMode("cache"); }
    }, 5000);
  }
  function stopPolling() { clearInterval(state.pollTimer); state.pollTimer = null; }

  // ---------------------------------------------------------------- commands
  async function sendCommand(target, text) {
    if (state.mode === "sim") return toast("Mode SIMULASI — perintah tidak dikirim ke agent.");
    text = (text || "").trim();
    if (!text) return $("#cmdText").focus();
    const token = ls.get(LS.admin);
    if (!token) { toast("Isi admin token dulu di Pengaturan."); return openSettings(); }
    try {
      const r = await fetchJSON("/commands", { method: "POST", body: { target, text }, token });
      upsertCommand(r.command); renderQueue();
      if (target !== "all") selectAgent(target);
      toast(`Perintah masuk antrean ${target === "all" ? "semua agent" : nameOf(target)} ✓`);
      return true;
    } catch (err) {
      if (err.status === 401) { toast("Admin token salah."); openSettings(); }
      else toast("Gagal kirim: " + err.message);
      return false;
    }
  }
  $("#cmdForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#cmdSend").disabled = true;
    const ok = await sendCommand($("#cmdTarget").value, $("#cmdText").value);
    if (ok) $("#cmdText").value = "";
    $("#cmdSend").disabled = state.mode === "sim";
  });

  // ---------------------------------------------------------------- SIMULASI (clearly labelled; mirrors the prototype engine)
  const SIM_TASKS = {
    bolo_airdrop: ["Memindai eligibility wallet untuk airdrop baru", "Mengecek snapshot & daftar klaim token", "Memantau pengumuman airdrop terbaru", "Verifikasi tugas testnet harian"],
    bolongonten: ["Render video Tongki episode baru", "Menulis naskah Shorts Calistung A–Z", "Menjadwalkan antrean upload konten", "Membuat thumbnail & caption video"],
    "hunter-2": ["Memindai permukaan serangan target", "Menjalankan PoC di sandbox lokal", "Memvalidasi temuan sebelum masuk laporan", "Menyusun paket bukti & hash SHA256"],
    "mas-wowo": ["Menyiapkan laporan triase vendor", "Mengecek antrean QC Dapur", "Memperbarui register temuan", "Merapikan catatan hunt terakhir"],
    "mas-wiwi": ["Mengelola dashboard pusat kendali", "Sinkronisasi status semua agent", "Menyiapkan ringkasan aktivitas harian", "Mengatur jadwal dan pengingat harian"],
  };
  function simFeed(agent_id, text, kind = "sim") {
    state.feed.unshift({ ts: new Date(serverNow()).toISOString(), agent_id, kind, text });
    state.feed.length = Math.min(state.feed.length, 30);
  }
  function startSim() {
    if (state.mode === "sim" && state.simTimer) return;
    if (!state.order.length) setAgents(DEFAULT_AGENTS);
    state.mode = "sim"; state.simDone = 0;
    const now = Date.now();
    state.order.forEach((id, i) => {
      const a = state.agents.get(id), tasks = SIM_TASKS[id] || ["Tugas contoh"];
      Object.assign(a, { status: "working", online: true, task: tasks[i % tasks.length], progress: 12 + ((i * 17) % 40), detail: null,
        last_seen: new Date(now).toISOString(), task_started: new Date(now).toISOString(), done_today: 0, _ti: i % tasks.length, _sp: 0.8 + (i % 3) * 0.25 });
    });
    state.feed = []; state.commands = [];
    simFeed(null, "Dashboard dibuka — 5 agent tampil dalam satu ruangan (mode SIMULASI)");
    renderAll();
    clearInterval(state.simTimer);
    let n = 0;
    state.simTimer = setInterval(() => {
      n++;
      state.order.forEach((id) => {
        const a = state.agents.get(id), tasks = SIM_TASKS[id] || ["Tugas contoh"];
        a.last_seen = new Date(serverNow()).toISOString();
        if (a.status !== "working") return;
        a.progress += (Math.random() * 2.1 + 0.7) * a._sp;
        if (a.progress >= 100) {
          simFeed(id, "menyelesaikan tugas: " + a.task, "done");
          a.done_today++; state.simDone++;
          a._ti = (a._ti + 1) % tasks.length; a.task = tasks[a._ti]; a.progress = 0; a.task_started = new Date(serverNow()).toISOString();
          renderFeed();
        }
      });
      if (n % 9 === 0) {
        const a = state.agents.get(state.order[Math.floor(Math.random() * state.order.length)]);
        if (a.status === "working" && Math.random() < 0.35) { a.status = "idle"; simFeed(a.agent_id, "rehat sebentar (idle)"); }
        else if (a.status === "idle") { a.status = "working"; a.task_started = new Date(serverNow()).toISOString(); simFeed(a.agent_id, "melanjutkan: " + a.task); }
        else simFeed(a.agent_id, ["menyimpan progres kerja", "sinkronisasi data terakhir", "memeriksa notifikasi masuk", "menjalankan pemeriksaan rutin"][n % 4]);
        renderFeed();
      }
      if (state.selected && state.agents.get(state.selected)) state.detailSig = state.detailSig; // timers refresh via tick
    }, 1000);
  }
  function stopSim() {
    clearInterval(state.simTimer); state.simTimer = null;
    if (state.mode === "sim") { state.mode = "connecting"; state.feed = []; }
  }

  // ---------------------------------------------------------------- settings / misc UI
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2600);
  }
  function openSettings() {
    $("#set-admin").value = ls.get(LS.admin) || "";
    $("#set-api").value = ls.get(LS.api) || "";
    $("#set-demo").checked = ls.get(LS.demo) === true;
    $("#settings").showModal();
  }
  $("#btn-settings").onclick = openSettings;
  $("#conn").onclick = () => toast({ live: "Tersambung live (SSE).", polling: "Live stream putus — polling tiap 5 dtk.", cache: "Offline — menampilkan data terakhir.", sim: "SIMULASI — bukan data asli agent.", connecting: "Menghubungkan…" }[state.mode]);
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

  let deferred = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; $("#btn-install").hidden = false; });
  $("#btn-install").onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $("#btn-install").hidden = true; };
  window.addEventListener("appinstalled", () => toast("Pusat Kendali Agent ter-install ✓"));
  window.addEventListener("online", () => connect());
  window.addEventListener("offline", () => { if (state.hasRealData) setMode("cache"); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && state.mode !== "live" && !FORCE_DEMO) connect(); });

  // ---------------------------------------------------------------- tick
  function tick() {
    const now = new Date(serverNow());
    const t = hms(now);
    $("#clock").textContent = t + " WIB";
    $("#dateLine").textContent = fLong.format(now);
    OfficeScene.setClock(t.slice(0, 5), fShort.format(now).replace(/\./g, "").toUpperCase() + " · WIB");
    if (state.order.length) renderAgents();
    renderLastSync();
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
