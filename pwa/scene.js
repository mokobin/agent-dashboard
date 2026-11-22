/* Virtual office scene — ported from docs/prototype.html (pusat-kendali-agent).
 * Static room SVG + one desk group per agent; agent state drives CSS classes. */
(function () {
  "use strict";
  const ROOM_SVG = "<svg viewBox=\"0 0 1200 660\" role=\"img\" aria-label=\"Ilustrasi kantor virtual malam hari dengan lima agent bekerja di meja masing-masing\">\n<defs>\n<linearGradient id=\"wallGrad\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\">\n<stop offset=\"0\" stop-color=\"#131f38\"/><stop offset=\"1\" stop-color=\"#1b2a47\"/>\n</linearGradient>\n<linearGradient id=\"skyGrad\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\">\n<stop offset=\"0\" stop-color=\"#0a1830\"/><stop offset=\"1\" stop-color=\"#274a7c\"/>\n</linearGradient>\n<linearGradient id=\"floorGrad\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\">\n<stop offset=\"0\" stop-color=\"#8a6844\"/><stop offset=\"1\" stop-color=\"#6f5133\"/>\n</linearGradient>\n<radialGradient id=\"glowGrad\" cx=\".5\" cy=\".5\" r=\".5\">\n<stop offset=\"0\" stop-color=\"#ffd9a0\" stop-opacity=\".85\"/><stop offset=\"1\" stop-color=\"#ffd9a0\" stop-opacity=\"0\"/>\n</radialGradient>\n<linearGradient id=\"screenGrad\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\">\n<stop offset=\"0\" stop-color=\"#12303a\"/><stop offset=\"1\" stop-color=\"#0b1e26\"/>\n</linearGradient>\n</defs>\n<!-- Wall -->\n<rect x=\"0\" y=\"0\" width=\"1200\" height=\"412\" fill=\"url(#wallGrad)\"/>\n<!-- Windows -->\n<g>\n<rect x=\"46\" y=\"52\" width=\"270\" height=\"212\" rx=\"10\" fill=\"url(#skyGrad)\" stroke=\"#2c3f61\" stroke-width=\"3\"/>\n<line x1=\"181\" y1=\"52\" x2=\"181\" y2=\"264\" stroke=\"#2c3f61\" stroke-width=\"4\"/>\n<line x1=\"46\" y1=\"158\" x2=\"316\" y2=\"158\" stroke=\"#2c3f61\" stroke-width=\"4\"/>\n<circle class=\"star\" cx=\"90\" cy=\"86\" r=\"2.2\" fill=\"#cfe4ff\"/><circle class=\"star\" cx=\"150\" cy=\"120\" r=\"1.6\" fill=\"#cfe4ff\" style=\"animation-delay:.7s\"/>\n<circle class=\"star\" cx=\"240\" cy=\"80\" r=\"2\" fill=\"#cfe4ff\" style=\"animation-delay:1.3s\"/><circle class=\"star\" cx=\"285\" cy=\"140\" r=\"1.5\" fill=\"#cfe4ff\" style=\"animation-delay:.4s\"/>\n<circle cx=\"272\" cy=\"88\" r=\"15\" fill=\"#e8eefc\"/><circle cx=\"266\" cy=\"83\" r=\"13\" fill=\"#0e1e3a\"/>\n<path d=\"M46 264 v-38 l26-12 v-16 l22 8 v20 l30-14 v52 Z M150 264 v-30 l24-10 v40 Z M214 264 v-44 l28 10 v34 Z\" fill=\"#0a1425\" opacity=\".85\"/>\n<rect x=\"66\" y=\"196\" width=\"5\" height=\"5\" fill=\"#ffd9a0\"/><rect x=\"104\" y=\"216\" width=\"5\" height=\"5\" fill=\"#ffd9a0\"/><rect x=\"238\" y=\"206\" width=\"5\" height=\"5\" fill=\"#ffd9a0\"/><rect x=\"168\" y=\"226\" width=\"5\" height=\"5\" fill=\"#ffd9a0\"/>\n</g>\n<g>\n<rect x=\"392\" y=\"52\" width=\"270\" height=\"212\" rx=\"10\" fill=\"url(#skyGrad)\" stroke=\"#2c3f61\" stroke-width=\"3\"/>\n<line x1=\"527\" y1=\"52\" x2=\"527\" y2=\"264\" stroke=\"#2c3f61\" stroke-width=\"4\"/>\n<line x1=\"392\" y1=\"158\" x2=\"662\" y2=\"158\" stroke=\"#2c3f61\" stroke-width=\"4\"/>\n<circle class=\"star\" cx=\"440\" cy=\"96\" r=\"1.8\" fill=\"#cfe4ff\" style=\"animation-delay:.9s\"/><circle class=\"star\" cx=\"590\" cy=\"76\" r=\"2.1\" fill=\"#cfe4ff\" style=\"animation-delay:.2s\"/>\n<circle class=\"star\" cx=\"622\" cy=\"128\" r=\"1.5\" fill=\"#cfe4ff\" style=\"animation-delay:1.6s\"/><circle class=\"star\" cx=\"486\" cy=\"132\" r=\"1.4\" fill=\"#cfe4ff\" style=\"animation-delay:2.1s\"/>\n<path d=\"M392 264 v-26 l30-12 v38 Z M470 264 v-48 l26 12 v-14 l24 10 v40 Z M560 264 v-34 l30-8 v42 Z\" fill=\"#0a1425\" opacity=\".85\"/>\n<rect x=\"416\" y=\"220\" width=\"5\" height=\"5\" fill=\"#ffd9a0\"/><rect x=\"492\" y=\"200\" width=\"5\" height=\"5\" fill=\"#ffd9a0\"/><rect x=\"600\" y=\"228\" width=\"5\" height=\"5\" fill=\"#ffd9a0\"/>\n</g>\n<!-- Kanban board -->\n<g>\n<rect x=\"716\" y=\"58\" width=\"212\" height=\"180\" rx=\"8\" fill=\"#22334f\" stroke=\"#31486e\" stroke-width=\"2\"/>\n<rect x=\"730\" y=\"74\" width=\"56\" height=\"34\" rx=\"3\" fill=\"#f4b8c1\"/><rect x=\"794\" y=\"74\" width=\"56\" height=\"34\" rx=\"3\" fill=\"#a7e8bd\"/>\n<rect x=\"858\" y=\"74\" width=\"56\" height=\"34\" rx=\"3\" fill=\"#ffe08a\"/><rect x=\"730\" y=\"118\" width=\"56\" height=\"34\" rx=\"3\" fill=\"#a5d8ff\"/>\n<rect x=\"794\" y=\"118\" width=\"56\" height=\"34\" rx=\"3\" fill=\"#d0bfff\"/><rect x=\"858\" y=\"118\" width=\"56\" height=\"34\" rx=\"3\" fill=\"#ffc9a3\"/>\n<rect x=\"730\" y=\"162\" width=\"56\" height=\"34\" rx=\"3\" fill=\"#b2f2bb\"/><rect x=\"794\" y=\"162\" width=\"56\" height=\"34\" rx=\"3\" fill=\"#ffd6a5\"/>\n<rect x=\"858\" y=\"162\" width=\"56\" height=\"34\" rx=\"3\" fill=\"#ffa8a8\"/>\n<text x=\"822\" y=\"226\" text-anchor=\"middle\" font-family=\"JetBrains Mono, monospace\" font-size=\"10\" fill=\"#7f93b5\" letter-spacing=\"2\">PIPELINE KERJA</text>\n</g>\n<!-- Wall screen / clock -->\n<g>\n<rect x=\"972\" y=\"52\" width=\"178\" height=\"238\" rx=\"10\" fill=\"#0a1322\" stroke=\"#2c3f61\" stroke-width=\"3\"/>\n<text id=\"wallClock\" x=\"1061\" y=\"152\" text-anchor=\"middle\" font-family=\"JetBrains Mono, monospace\" font-weight=\"700\" font-size=\"46\" fill=\"#7ee2fc\">--:--</text>\n<text id=\"wallDate\" x=\"1061\" y=\"182\" text-anchor=\"middle\" font-family=\"JetBrains Mono, monospace\" font-size=\"12\" fill=\"#5f7ca6\">WIB</text>\n<rect x=\"996\" y=\"208\" width=\"130\" height=\"7\" rx=\"3.5\" fill=\"#1d2f4d\"/>\n<rect x=\"996\" y=\"226\" width=\"96\" height=\"7\" rx=\"3.5\" fill=\"#1d2f4d\"/>\n<rect x=\"996\" y=\"244\" width=\"112\" height=\"7\" rx=\"3.5\" fill=\"#1d2f4d\"/>\n<circle cx=\"1003\" cy=\"76\" r=\"4\" fill=\"#4ade80\"/>\n</g>\n<!-- Wall clock deco -->\n<g opacity=\".9\"><circle cx=\"356\" cy=\"86\" r=\"17\" fill=\"none\" stroke=\"#5f7ca6\" stroke-width=\"3\"/><line x1=\"356\" y1=\"86\" x2=\"356\" y2=\"75\" stroke=\"#5f7ca6\" stroke-width=\"3\" stroke-linecap=\"round\"/><line x1=\"356\" y1=\"86\" x2=\"364\" y2=\"90\" stroke=\"#5f7ca6\" stroke-width=\"3\" stroke-linecap=\"round\"/></g>\n<!-- Floor -->\n<polygon points=\"0,660 1200,660 1200,412 0,412\" fill=\"url(#floorGrad)\"/>\n<g stroke=\"#5d422a\" stroke-width=\"2\" opacity=\".55\">\n<line x1=\"0\" y1=\"470\" x2=\"1200\" y2=\"470\"/><line x1=\"0\" y1=\"540\" x2=\"1200\" y2=\"540\"/><line x1=\"0\" y1=\"612\" x2=\"1200\" y2=\"612\"/>\n<line x1=\"200\" y1=\"412\" x2=\"140\" y2=\"660\"/><line x1=\"450\" y1=\"412\" x2=\"430\" y2=\"660\"/><line x1=\"700\" y1=\"412\" x2=\"720\" y2=\"660\"/><line x1=\"950\" y1=\"412\" x2=\"1010\" y2=\"660\"/>\n</g>\n<ellipse cx=\"430\" cy=\"580\" rx=\"330\" ry=\"52\" fill=\"#31456b\" opacity=\".5\"/>\n<ellipse cx=\"430\" cy=\"580\" rx=\"330\" ry=\"52\" fill=\"none\" stroke=\"#41598a\" stroke-width=\"2\" opacity=\".6\"/>\n<!-- Sofa lounge (left) -->\n<g>\n<rect x=\"36\" y=\"512\" width=\"128\" height=\"52\" rx=\"14\" fill=\"#3d4c63\"/>\n<rect x=\"28\" y=\"488\" width=\"144\" height=\"42\" rx=\"14\" fill=\"#46566f\"/>\n<rect x=\"40\" y=\"540\" width=\"46\" height=\"30\" rx=\"8\" fill=\"#37455c\"/><rect x=\"112\" y=\"540\" width=\"46\" height=\"30\" rx=\"8\" fill=\"#37455c\"/>\n<rect x=\"182\" y=\"540\" width=\"86\" height=\"10\" rx=\"4\" fill=\"#5d422a\"/>\n<rect x=\"192\" y=\"550\" width=\"8\" height=\"26\" fill=\"#4a3520\"/><rect x=\"250\" y=\"550\" width=\"8\" height=\"26\" fill=\"#4a3520\"/>\n<rect x=\"200\" y=\"522\" width=\"34\" height=\"20\" rx=\"3\" fill=\"#202c42\"/><rect x=\"204\" y=\"526\" width=\"26\" height=\"12\" fill=\"#3d5a80\"/>\n</g>\n<!-- Plant -->\n<g>\n<path d=\"M1108 640 l10-26 h44 l10 26 Z\" fill=\"#7a4a2b\"/>\n<path d=\"M1140 616 c-16-26-34-30-44-28 6 14 20 26 44 28Zm0 0c2-30 14-42 26-46 2 16-6 36-26 46Zm0 0c-4-24-16-34-28-36 2 14 12 30 28 36Z\" fill=\"#3f9e63\"/>\n</g>\n<g>\n<path d=\"M66 420 l7-20 h32 l7 20 Z\" fill=\"#7a4a2b\"/>\n<path d=\"M89 402 c-12-20-26-23-34-21 5 11 15 20 34 21Zm0 0c2-23 11-32 20-35 1 12-5 27-20 35Z\" fill=\"#3f9e63\"/>\n</g>\n<!-- Meeting room (front right) -->\n<g>\n<rect x=\"806\" y=\"452\" width=\"352\" height=\"196\" rx=\"10\" fill=\"#9fc3e8\" opacity=\".07\"/>\n<rect x=\"806\" y=\"452\" width=\"352\" height=\"196\" rx=\"10\" fill=\"none\" stroke=\"#9fc3e8\" stroke-width=\"2\" opacity=\".35\"/>\n<polygon points=\"852,586 1112,586 1136,622 828,622\" fill=\"#4a3520\"/>\n<polygon points=\"852,586 1112,586 1118,600 846,600\" fill=\"#5d422a\"/>\n<g fill=\"#232f45\">\n<rect x=\"862\" y=\"540\" width=\"34\" height=\"42\" rx=\"9\"/><rect x=\"928\" y=\"540\" width=\"34\" height=\"42\" rx=\"9\"/><rect x=\"994\" y=\"540\" width=\"34\" height=\"42\" rx=\"9\"/><rect x=\"1060\" y=\"540\" width=\"34\" height=\"42\" rx=\"9\"/>\n</g>\n<g fill=\"#1b2639\">\n<rect x=\"876\" y=\"618\" width=\"34\" height=\"40\" rx=\"9\"/><rect x=\"950\" y=\"618\" width=\"34\" height=\"40\" rx=\"9\"/><rect x=\"1024\" y=\"618\" width=\"34\" height=\"40\" rx=\"9\"/>\n</g>\n<text x=\"982\" y=\"478\" text-anchor=\"middle\" font-family=\"Manrope, sans-serif\" font-weight=\"700\" font-size=\"13\" fill=\"#9fc3e8\" opacity=\".8\">RUANG MEETING</text>\n</g>\n<g id=\"deskLayer\"></g>\n</svg>";

  // Desk slots (same layout as the prototype): transform + chip anchor (% of scene).
  const SLOTS = [
    { t: "translate(196,392)", chip: { left: 16.3, top: 30.5 } },
    { t: "translate(492,392)", chip: { left: 41.0, top: 30.5 } },
    { t: "translate(782,384) scale(.94)", chip: { left: 65.2, top: 30.0 } },
    { t: "translate(292,556)", chip: { left: 24.3, top: 55.5 } },
    { t: "translate(618,556)", chip: { left: 51.5, top: 55.5 } },
  ];

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function deskSVG(a) {
    const shirt = a.shirt || a.color || "#475569", skin = a.skin || "#c68642", hair = a.hair || "#1f1510", color = a.color || "#e8590c";
    const lines = [0, 1, 2, 3].map((i) => {
      const w = [52, 66, 40, 58][i], c = ["#4ade80", "#7ee2fc", "#fbbf24", "#4ade80"][i];
      return `<rect class="code-line" x="4" y="${-44 + i * 11}" width="${w}" height="5" rx="2.5" fill="${c}" style="animation-delay:${i * 0.45}s"/>`;
    }).join("");
    return `<ellipse class="focusring" cx="0" cy="30" rx="126" ry="22" fill="none" stroke="${color}" stroke-width="2.5" stroke-dasharray="7 6"/>
      <circle class="lampglow" cx="-74" cy="-76" r="46" fill="url(#glowGrad)"/>
      <line x1="-74" y1="-30" x2="-74" y2="-82" stroke="#39445c" stroke-width="4" stroke-linecap="round"/>
      <polygon points="-90,-82 -58,-82 -65,-99 -83,-99" fill="#f2c14e"/>
      <rect x="-36" y="-106" width="72" height="70" rx="15" fill="#26334d"/>
      <g class="char">
        <rect x="-25" y="-106" width="50" height="56" rx="15" fill="${shirt}"/>
        <line x1="20" y1="-84" x2="44" y2="-52" stroke="${shirt}" stroke-width="11" stroke-linecap="round"/>
        <circle cx="0" cy="-126" r="17.5" fill="${skin}"/>
        <path d="M-17.5 -128 a17.5 17.5 0 0 1 35 0 l0 -3 a17.5 12 0 0 0 -35 0 Z" fill="${hair}"/>
      </g>
      <polygon points="-106,-34 106,-34 88,-6 -88,-6" fill="#7d5636"/>
      <polygon points="-88,-6 88,-6 88,17 -88,17" fill="#5d3f24"/>
      <rect x="-82" y="17" width="9" height="20" fill="#4a3520"/><rect x="73" y="17" width="9" height="20" fill="#4a3520"/>
      <g transform="translate(58,-40)">
        <rect x="-8" y="-56" width="92" height="62" rx="7" fill="#10151f" stroke="#33415e" stroke-width="2"/>
        <rect x="-2" y="-50" width="80" height="50" fill="url(#screenGrad)"/>${lines}
        <rect x="28" y="6" width="9" height="13" fill="#33415e"/><rect x="12" y="19" width="42" height="5" rx="2.5" fill="#33415e"/>
      </g>
      <rect x="-46" y="-44" width="13" height="11" rx="2.5" fill="#e2e8f0"/>
      <g class="mug-steam"><path d="M-42,-48 q -3,-6 0,-11 q 3,-5 0,-10" stroke="#cbd5e1" stroke-width="2" fill="none"/><path d="M-37,-49 q -3,-5 0,-9 q 3,-4 0,-8" stroke="#cbd5e1" stroke-width="2" fill="none"/></g>
      <rect x="-78" y="-38" width="32" height="4.5" rx="2" fill="#dbe4f0" transform="rotate(-4 -62 -36)"/>
      <circle cx="-96" cy="-40" r="4" fill="#3f9e63"/><circle cx="-90" cy="-47" r="4.5" fill="#35795a"/><circle cx="-101" cy="-48" r="3.5" fill="#3f9e63"/>
      <g class="away"><rect x="-28" y="-30" width="56" height="20" rx="5" fill="#0f172a" stroke="#475569"/><text x="0" y="-15.5" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="11" font-weight="700" fill="#94a3b8">AWAY</text></g>`;
  }

  function build(sceneWrap, agents, onSelect) {
    sceneWrap.querySelector("#sceneSvg").innerHTML = ROOM_SVG;
    const layer = sceneWrap.querySelector("#deskLayer");
    const chips = sceneWrap.querySelector("#chipLayer");
    layer.innerHTML = ""; chips.innerHTML = "";
    // back row first so the front row paints over it
    const placed = agents.map((a, i) => ({ a, slot: SLOTS[(a.desk ?? i) % SLOTS.length] }));
    placed.sort((p, q) => p.slot.chip.top - q.slot.chip.top);
    placed.forEach(({ a, slot }) => {
      layer.insertAdjacentHTML("beforeend", `<g class="scene-agent offline" id="scene-${esc(a.agent_id)}" data-agent="${esc(a.agent_id)}" transform="${slot.t}">${deskSVG(a)}</g>`);
      const el = document.createElement("button");
      el.type = "button"; el.className = "chip"; el.id = "chip-" + a.agent_id; el.dataset.agent = a.agent_id;
      el.style.left = slot.chip.left + "%"; el.style.top = slot.chip.top + "%";
      el.setAttribute("data-status", "offline");
      el.innerHTML = `<span class="dot"></span><span>${esc(a.name)}</span><span class="st">Offline</span>`;
      chips.appendChild(el);
    });
    layer.querySelectorAll(".scene-agent").forEach((g) => g.addEventListener("click", () => onSelect(g.dataset.agent)));
    chips.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => onSelect(c.dataset.agent)));
  }

  const ST_LABEL = { working: "Bekerja", idle: "Idle", offline: "Offline" };

  function update(a, selected) {
    const g = document.getElementById("scene-" + a.agent_id), c = document.getElementById("chip-" + a.agent_id);
    if (g) g.setAttribute("class", `scene-agent ${a.status}${selected ? " selected" : ""}`);
    if (c) {
      c.setAttribute("data-status", a.status);
      c.classList.toggle("selected", !!selected);
      c.querySelector(".st").textContent = ST_LABEL[a.status] || a.status;
    }
  }

  function chipPos(agentId) {
    const c = document.getElementById("chip-" + agentId);
    return c ? { left: parseFloat(c.style.left), top: parseFloat(c.style.top) } : { left: 50, top: 50 };
  }

  function setClock(hhmm, dateLine) {
    const wc = document.getElementById("wallClock"), wd = document.getElementById("wallDate");
    if (wc) wc.textContent = hhmm;
    if (wd) wd.textContent = dateLine;
  }

  window.OfficeScene = { build, update, chipPos, setClock, esc };
})();
