/* Isometric virtual office — pure SVG, no dependencies.
 * World units: room is 10 x 10 floor, walls 3.6 high. */
(function () {
  const T = 42, C = 0.8660254 * T, S = 0.5 * T, OX = 500, OY = 180, WALL = 3.6;
  const NS = "http://www.w3.org/2000/svg";

  const iso = (x, y, z = 0) => [OX + (x - y) * C, OY + (x + y) * S - z * T];
  const pts = (arr) => arr.map((p) => iso(...p).map((n) => n.toFixed(1)).join(",")).join(" ");
  const poly = (arr, fill, extra = "") => `<polygon points="${pts(arr)}" fill="${fill}" ${extra}/>`;

  // Affine transforms that let us draw "flat" on a plane using world units.
  const M_FLOOR = `matrix(${C},${S},${-C},${S},${OX},${OY})`; // (x,y) on floor
  const M_RWALL = `matrix(${C},${S},0,${T},${OX},${OY})`;     // (x, -z) on y=0 wall
  const M_LWALL = `matrix(${-C},${S},0,${T},${OX},${OY})`;    // (y, -z) on x=0 wall

  function box(x, y, z, w, d, h, top, left, right, extra = "") {
    return (
      poly([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]], left, extra) +
      poly([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]], right, extra) +
      poly([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]], top, extra)
    );
  }

  // Character seat positions (cx, cy) — the person sits at cy, desk spans cy+0.5 .. cy+1.6
  const DESKS = [
    { cx: 1.4, cy: 5.6 },
    { cx: 3.7, cy: 3.3 },
    { cx: 6.0, cy: 1.0 },
    { cx: 4.6, cy: 6.9 },
    { cx: 7.1, cy: 4.4 },
  ];

  function room() {
    let s = "";
    // floor
    s += `<g transform="${M_FLOOR}">`;
    s += `<rect x="0" y="0" width="10" height="10" fill="#1b2340"/>`;
    for (let i = 0; i < 10; i++)
      for (let j = 0; j < 10; j++)
        if ((i + j) % 2 === 0) s += `<rect x="${i}" y="${j}" width="1" height="1" fill="#1f2848"/>`;
    for (let i = 1; i < 10; i++)
      s += `<line x1="${i}" y1="0" x2="${i}" y2="10" stroke="#27315a" stroke-width="1" vector-effect="non-scaling-stroke" opacity=".55"/>` +
           `<line x1="0" y1="${i}" x2="10" y2="${i}" stroke="#27315a" stroke-width="1" vector-effect="non-scaling-stroke" opacity=".55"/>`;
    // window light spill + rug
    s += `<polygon points="0,2.6 0,7.4 3.4,8.4 3.4,1.6" fill="url(#spill)" opacity=".55"/>`;
    s += `<rect x="0.35" y="8.25" width="2.6" height="1.45" rx="0.35" fill="#5b2a4a"/>`;
    s += `<rect x="0.55" y="8.45" width="2.2" height="1.05" rx="0.25" fill="none" stroke="#c0789f" stroke-width="1.2" vector-effect="non-scaling-stroke" stroke-dasharray="4 3"/>`;
    s += `</g>`;

    // walls
    s += poly([[0, 0, 0], [0, 10, 0], [0, 10, WALL], [0, 0, WALL]], "#2a3360");
    s += poly([[0, 0, 0], [10, 0, 0], [10, 0, WALL], [0, 0, WALL]], "#323d72");
    // skirting
    s += poly([[0, 0, 0], [0, 10, 0], [0, 10, 0.18], [0, 0, 0.18]], "#1a2146");
    s += poly([[0, 0, 0], [10, 0, 0], [10, 0, 0.18], [0, 0, 0.18]], "#20295a");
    // wall top edges
    s += poly([[0, 0, WALL], [0, 10, WALL], [-0.15, 10, WALL], [-0.15, 0, WALL]], "#3d4a88");
    s += poly([[0, 0, WALL], [10, 0, WALL], [10, -0.15, WALL], [0, -0.15, WALL]], "#4655a0");

    // ---- left wall: window with night city
    s += `<g transform="${M_LWALL}">`;
    s += `<rect x="2.6" y="-3.15" width="4.8" height="2.0" fill="#0b1026" stroke="#6b7bd1" stroke-width="3" vector-effect="non-scaling-stroke"/>`;
    s += `<rect x="2.6" y="-3.15" width="4.8" height="2.0" fill="url(#sky)"/>`;
    s += `<circle cx="6.6" cy="-2.75" r="0.22" fill="#fef3c7"/><circle cx="6.68" cy="-2.8" r="0.2" fill="#121a3d" opacity=".9"/>`;
    const stars = [[3.0, -3.0], [3.6, -2.85], [4.3, -3.05], [5.1, -2.9], [5.8, -3.02], [7.1, -2.95], [4.8, -2.7], [3.3, -2.6]];
    stars.forEach(([x, y], i) => (s += `<circle class="twinkle" style="animation-delay:${i * 0.7}s" cx="${x}" cy="${y}" r="0.025" fill="#fff"/>`));
    const bld = [[2.6, 0.55, 0.9], [3.15, 0.45, 1.3], [3.6, 0.6, 0.75], [4.2, 0.4, 1.55], [4.6, 0.7, 1.05], [5.3, 0.5, 1.4], [5.8, 0.55, 0.85], [6.35, 0.45, 1.2], [6.8, 0.6, 0.95]];
    bld.forEach(([x, w, h], bi) => {
      s += `<rect x="${x}" y="${-1.15 - h}" width="${w}" height="${h}" fill="${bi % 2 ? "#141b3f" : "#18204a"}"/>`;
      for (let r = 0; r < Math.floor(h / 0.22); r++)
        for (let c = 0; c < Math.floor(w / 0.15); c++) {
          if ((bi * 7 + r * 3 + c * 5) % 4 === 0) continue;
          const lit = (bi + r + c) % 3 === 0;
          s += `<rect class="${lit ? "citylit" : ""}" style="animation-delay:${((bi * 13 + r * 7 + c * 3) % 17) * 0.6}s" x="${(x + 0.05 + c * 0.15).toFixed(2)}" y="${(-1.15 - h + 0.08 + r * 0.22).toFixed(2)}" width="0.07" height="0.1" fill="${lit ? "#fcd34d" : "#2b356b"}"/>`;
        }
    });
    s += `<line x1="5" y1="-3.15" x2="5" y2="-1.15" stroke="#6b7bd1" stroke-width="3" vector-effect="non-scaling-stroke"/>`;
    s += `<line x1="2.6" y1="-2.15" x2="7.4" y2="-2.15" stroke="#6b7bd1" stroke-width="2" vector-effect="non-scaling-stroke" opacity=".7"/>`;
    s += `<rect x="2.45" y="-1.15" width="5.1" height="0.12" fill="#7d8be0"/>`;
    s += `</g>`;

    // ---- right wall: clock, sign, board
    s += `<g transform="${M_RWALL}">`;
    s += `<circle cx="2.1" cy="-2.65" r="0.52" fill="#f8fafc" stroke="#94a3b8" stroke-width="3" vector-effect="non-scaling-stroke"/>`;
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6, r1 = i % 3 ? 0.42 : 0.36;
      s += `<line x1="${2.1 + Math.sin(a) * r1}" y1="${-2.65 - Math.cos(a) * r1}" x2="${2.1 + Math.sin(a) * 0.47}" y2="${-2.65 - Math.cos(a) * 0.47}" stroke="#334155" stroke-width="${i % 3 ? 1 : 2}" vector-effect="non-scaling-stroke"/>`;
    }
    s += `<line id="clk-h" x1="2.1" y1="-2.65" x2="2.1" y2="-2.93" stroke="#0f172a" stroke-width="3.2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
    s += `<line id="clk-m" x1="2.1" y1="-2.65" x2="2.1" y2="-3.05" stroke="#0f172a" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
    s += `<line id="clk-s" x1="2.1" y1="-2.65" x2="2.1" y2="-3.08" stroke="#ef4444" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
    s += `<circle cx="2.1" cy="-2.65" r="0.04" fill="#ef4444"/>`;
    s += `<text x="2.1" y="-1.95" font-size="0.22" text-anchor="middle" fill="#c7d2fe" font-weight="700" letter-spacing="0.02">WIB</text>`;
    // sign
    s += `<rect x="3.6" y="-3.25" width="3.0" height="0.75" rx="0.12" fill="#111735" stroke="#7c3aed" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
    s += `<text class="neon" x="5.1" y="-2.72" font-size="0.42" text-anchor="middle" fill="#c4b5fd" font-weight="800" letter-spacing="0.06">BOLO HQ</text>`;
    // board with sticky notes
    s += `<rect x="7.0" y="-3.0" width="2.3" height="1.5" fill="#e2e8f0" stroke="#64748b" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
    [["#fde68a", 7.15, -2.85], ["#a7f3d0", 7.75, -2.8], ["#fbcfe8", 8.35, -2.88], ["#bfdbfe", 7.3, -2.2], ["#fde68a", 8.0, -2.25], ["#ddd6fe", 8.65, -2.15]].forEach(
      ([c, x, y]) => (s += `<rect x="${x}" y="${y}" width="0.48" height="0.45" fill="${c}"/>`)
    );
    s += `<polyline points="7.2,-1.65 7.6,-1.9 8.0,-1.75 8.5,-2.05 9.1,-1.7" fill="none" stroke="#ef4444" stroke-width="1.5" vector-effect="non-scaling-stroke" opacity=".0"/>`;
    s += `</g>`;
    return s;
  }

  function plant(x, y) {
    let s = box(x - 0.3, y - 0.3, 0, 0.6, 0.6, 0.55, "#b45309", "#92400e", "#78350f");
    const [px, py] = iso(x, y, 0.55);
    s += `<g class="sway" style="transform-origin:${px}px ${py}px">`;
    [[-16, -40, "#16a34a"], [14, -44, "#22c55e"], [-4, -58, "#15803d"], [20, -26, "#16a34a"], [-22, -24, "#22c55e"]].forEach(
      ([dx, dy, c]) => (s += `<ellipse cx="${px + dx * 0.6}" cy="${py + dy * 0.6}" rx="10" ry="20" fill="${c}" transform="rotate(${dx * 1.3} ${px + dx * 0.6} ${py + dy * 0.6})"/>`)
    );
    s += `</g>`;
    return s;
  }

  function shelf(x, y) {
    // bookshelf against left wall
    let s = box(x, y, 0, 0.45, 1.6, 2.2, "#7c4a24", "#5b3418", "#6b3e1e");
    const cols = ["#ef4444", "#3b82f6", "#f59e0b", "#10b981", "#8b5cf6", "#ec4899", "#14b8a6"];
    for (let r = 0; r < 4; r++) {
      const z = 0.15 + r * 0.52;
      for (let b = 0; b < 6; b++) {
        if ((r * 5 + b) % 7 === 3) continue;
        const yy = y + 0.12 + b * 0.24;
        s += poly([[x + 0.45, yy, z], [x + 0.45, yy + 0.18, z], [x + 0.45, yy + 0.18, z + 0.38 + ((b + r) % 3) * 0.04], [x + 0.45, yy, z + 0.38 + ((b + r) % 3) * 0.04]], cols[(r * 3 + b) % cols.length]);
      }
      s += poly([[x + 0.45, y, z - 0.04], [x + 0.45, y + 1.6, z - 0.04], [x + 0.45, y + 1.6, z], [x + 0.45, y, z]], "#3f2410");
    }
    return s;
  }

  function cat(x, y) {
    const [px, py] = iso(x, y, 0.02);
    return `<g class="cat">
      <ellipse cx="${px}" cy="${py + 4}" rx="30" ry="9" fill="#000" opacity=".25"/>
      <path d="M${px + 22},${py - 2} q 22,-4 18,-20 q -2,-6 -6,-2 q 2,12 -14,14 z" fill="#f59e0b"/>
      <ellipse class="breathe" cx="${px}" cy="${py - 6}" rx="26" ry="14" fill="#fb923c"/>
      <path d="M${px - 14},${py - 14} q 6,-6 14,-2" stroke="#ea580c" stroke-width="3" fill="none"/>
      <path d="M${px - 2},${py - 17} q 6,-5 12,0" stroke="#ea580c" stroke-width="3" fill="none"/>
      <circle cx="${px - 22}" cy="${py - 8}" r="11" fill="#fb923c"/>
      <polygon points="${px - 31},${py - 14} ${px - 29},${py - 25} ${px - 22},${py - 17}" fill="#fb923c"/>
      <polygon points="${px - 20},${py - 18} ${px - 14},${py - 26} ${px - 12},${py - 14}" fill="#fb923c"/>
      <path d="M${px - 28},${py - 8} q 3,2 6,0 M${px - 20},${py - 8} q 3,2 6,0" stroke="#7c2d12" stroke-width="1.6" fill="none"/>
      <text class="zzz z1" x="${px - 16}" y="${py - 30}" fill="#c7d2fe" font-size="13" font-weight="700">z</text>
      <text class="zzz z2" x="${px - 8}" y="${py - 42}" fill="#c7d2fe" font-size="16" font-weight="700">Z</text>
      <text class="zzz z3" x="${px + 2}" y="${py - 56}" fill="#c7d2fe" font-size="19" font-weight="700">Z</text>
    </g>`;
  }

  function coffee(x, y) {
    let s = box(x - 0.35, y - 0.3, 0, 0.7, 0.6, 1.0, "#475569", "#334155", "#1e293b");
    s += box(x - 0.18, y - 0.12, 1.0, 0.36, 0.3, 0.22, "#e2e8f0", "#cbd5e1", "#94a3b8");
    const [px, py] = iso(x, y + 0.3, 0.55);
    s += `<circle cx="${px}" cy="${py}" r="4" fill="#22c55e" class="blink"/>`;
    return s;
  }

  function desk(i, a) {
    const { cx, cy } = DESKS[i];
    const dx = cx - 1.0, dy = cy + 0.5, W = 2.0, D = 1.1, H = 0.82;
    const color = a.color || "#60a5fa";
    let back = "", front = "";
    // floor status ring (under chair)
    const [rx, ry] = iso(cx, cy, 0);
    back += `<ellipse class="ring" cx="${rx}" cy="${ry}" rx="36" ry="18" fill="none" stroke="currentColor" stroke-width="3"/>`;
    back += `<ellipse cx="${rx}" cy="${ry}" rx="30" ry="15" fill="currentColor" opacity=".12"/>`;
    // chair back + seat
    back += box(cx - 0.32, cy - 0.42, 0.45, 0.64, 0.1, 0.8, "#475569", "#334155", "#1e293b");
    back += box(cx - 0.34, cy - 0.34, 0.42, 0.68, 0.68, 0.08, "#64748b", "#475569", "#334155");
    back += box(cx - 0.05, cy - 0.05, 0, 0.1, 0.1, 0.42, "#94a3b8", "#64748b", "#475569");

    // person (screen-space drawing anchored at seat)
    const [bx, by] = iso(cx, cy, 0.5);
    back += `<g class="person">
      <g class="bob">
        <rect x="${bx - 15}" y="${by - 34}" width="30" height="36" rx="12" fill="${color}"/>
        <rect x="${bx - 15}" y="${by - 34}" width="30" height="36" rx="12" fill="#000" opacity=".18"/>
        <circle cx="${bx}" cy="${by - 48}" r="13" fill="#f2c9a0"/>
        <path d="M${bx - 13.5},${by - 49} a13.5,13.5 0 0 1 27,0 q -6,-6 -13.5,-5 q -7,-1 -13.5,5 z" fill="${shade(color)}"/>
        <g class="eyes"><circle cx="${bx - 4.5}" cy="${by - 46}" r="1.7" fill="#1e293b"/><circle cx="${bx + 4.5}" cy="${by - 46}" r="1.7" fill="#1e293b"/></g>
        <path class="mouth" d="M${bx - 3},${by - 40} q 3,2 6,0" stroke="#9a3412" stroke-width="1.3" fill="none"/>
        <rect class="headset" x="${bx - 15}" y="${by - 52}" width="4" height="9" rx="2" fill="#0f172a"/>
      </g>
    </g>`;

    // desk legs + top + drawer
    front += box(dx + 0.05, dy + D - 0.12, 0, 0.07, 0.07, H, "#94a3b8", "#64748b", "#475569");
    front += box(dx + 0.05, dy + 0.05, 0, 0.07, 0.07, H, "#94a3b8", "#64748b", "#475569");
    front += box(dx + W - 0.62, dy + 0.06, 0, 0.56, D - 0.12, H, "#cbd5e1", "#94a3b8", "#64748b");
    front += poly([[dx + W - 0.61, dy + D - 0.06, 0.5], [dx + W - 0.07, dy + D - 0.06, 0.5], [dx + W - 0.07, dy + D - 0.06, 0.53], [dx + W - 0.61, dy + D - 0.06, 0.53]], "#475569");
    front += box(dx, dy, H, W, D, 0.08, "#e7d3b5", "#c9ad85", "#a88b62");

    // laptop: keyboard near person, screen facing person (we see its back)
    const kx = cx - 0.36, ky = dy + 0.08;
    front += box(kx, ky, H + 0.08, 0.72, 0.42, 0.03, "#1f2937", "#111827", "#0b1220");
    front += `<g class="laptop-open">` +
      poly([[kx, ky + 0.45, H + 0.11], [kx + 0.72, ky + 0.45, H + 0.11], [kx + 0.72, ky + 0.52, H + 0.6], [kx, ky + 0.52, H + 0.6]], "#cbd5e1") +
      poly([[kx + 0.72, ky + 0.45, H + 0.11], [kx + 0.72, ky + 0.47, H + 0.11], [kx + 0.72, ky + 0.54, H + 0.6], [kx + 0.72, ky + 0.52, H + 0.6]], "#94a3b8");
    const [lx, ly] = iso(cx, ky + 0.49, H + 0.37);
    front += `<circle cx="${lx}" cy="${ly}" r="4" fill="${color}" class="logo"/>`;
    front += `<polygon class="glow" points="${pts([[kx - 0.05, ky + 0.44, H + 0.1], [kx + 0.77, ky + 0.44, H + 0.1], [kx + 0.8, ky + 0.53, H + 0.66], [kx - 0.08, ky + 0.53, H + 0.66]])}" fill="none" stroke="${color}" stroke-width="2"/>`;
    front += `</g>`;
    // code glyphs floating while typing
    const [gx, gy] = iso(cx, ky + 0.5, H + 0.75);
    front += `<g class="glyphs"><text x="${gx - 22}" y="${gy}" class="g g1">{ }</text><text x="${gx + 6}" y="${gy}" class="g g2">&lt;/&gt;</text><text x="${gx - 6}" y="${gy}" class="g g3">01</text></g>`;
    // mug (steam when idle)
    const mx = dx + W - 0.42, my = dy + 0.35;
    front += box(mx, my, H + 0.08, 0.2, 0.2, 0.2, "#f8fafc", "#e2e8f0", "#cbd5e1");
    const [sx, sy] = iso(mx + 0.1, my + 0.1, H + 0.3);
    front += `<g class="steam"><path d="M${sx - 3},${sy} q -4,-7 0,-13 q 4,-6 0,-12" stroke="#cbd5e1" stroke-width="2" fill="none"/><path d="M${sx + 4},${sy - 2} q -4,-6 0,-11 q 4,-5 0,-10" stroke="#cbd5e1" stroke-width="2" fill="none"/></g>`;
    // offline "zz" sign on desk
    const [ox, oy] = iso(cx, dy + 0.6, H + 0.3);
    front += `<g class="away"><rect x="${ox - 26}" y="${oy - 14}" width="52" height="18" rx="4" fill="#0f172a" stroke="#475569"/><text x="${ox}" y="${oy}" text-anchor="middle" font-size="11" fill="#94a3b8" font-weight="700">AWAY</text></g>`;

    return {
      depth: cx + cy,
      svg: `<g class="desk status-offline" id="desk-${a.agent_id}" data-agent="${a.agent_id}" style="color:#64748b">${back}${front}</g>`,
      head: iso(cx, cy, 0.5).map((n, k) => (k ? n - 66 : n)),
      label: iso(dx + W / 2, dy + D, 0),
    };
  }

  function shade(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, (n >> 16) - 70), g = Math.max(0, ((n >> 8) & 255) - 70), b = Math.max(0, (n & 255) - 70);
    return `rgb(${r},${g},${b})`;
  }

  const VB = { x: 100, y: 20, w: 800, h: 600 };

  function build(container, agents) {
    const objects = [];
    agents.forEach((a, idx) => objects.push(desk(a.desk ?? idx, a)));
    const props = [
      { depth: 9.2 + 0.7, svg: plant(9.2, 0.7) },
      { depth: 0.9 + 0.3, svg: shelf(0.05, 0.25) },
      { depth: 0.45 + 7.75, svg: plant(0.45, 7.75) },
      { depth: 1.65 + 9.0, svg: cat(1.65, 9.0) },
      { depth: 9.2 + 2.6, svg: coffee(9.2, 2.6) },
    ];
    const all = objects.concat(props).sort((p, q) => p.depth - q.depth);
    const svg = `<svg viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}" xmlns="${NS}" role="img" aria-label="Kantor virtual agent">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1030"/><stop offset="1" stop-color="#3b2a6b"/></linearGradient>
        <linearGradient id="spill" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8b9cff" stop-opacity=".35"/><stop offset="1" stop-color="#8b9cff" stop-opacity="0"/></linearGradient>
        <radialGradient id="vign" cx=".5" cy=".55" r=".75"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>
      </defs>
      ${room()}
      ${all.map((o) => o.svg).join("")}
      <rect x="${VB.x}" y="${VB.y}" width="${VB.w}" height="${VB.h}" fill="url(#vign)" pointer-events="none"/>
    </svg>`;
    container.querySelector(".scene-svg").innerHTML = svg;

    // HTML overlays (bubbles + labels), positioned in % of viewBox
    const ov = container.querySelector(".scene-overlay");
    ov.innerHTML = "";
    objects.forEach((o, k) => {
      const a = agents[k];
      const pct = ([x, y]) => [((x - VB.x) / VB.w) * 100, ((y - VB.y) / VB.h) * 100];
      const [hx, hy] = pct(o.head);
      ov.insertAdjacentHTML("beforeend",
        `<button class="bubble" id="bub-${a.agent_id}" data-agent="${a.agent_id}" style="left:${hx}%;top:${hy}%">
           <span class="b-head"><i class="dot"></i><b>${esc(a.name)}</b><em class="plat">${(a.platform || "").toUpperCase()}</em></span>
           <span class="b-task">…</span>
         </button>`);
    });
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  const STATUS_COLOR = { working: "#22c55e", idle: "#f59e0b", offline: "#64748b" };

  function update(a, taskText) {
    const d = document.getElementById("desk-" + a.agent_id);
    const b = document.getElementById("bub-" + a.agent_id);
    if (!d || !b) return;
    const st = a.status || "offline";
    d.setAttribute("class", "desk status-" + st);
    d.style.color = STATUS_COLOR[st];
    b.className = "bubble status-" + st + (b.classList.contains("open") ? " open" : "");
    b.querySelector(".b-task").textContent = taskText;
  }

  function setClock(h, m, s) {
    const rot = (id, deg) => {
      const el = document.getElementById(id);
      if (el) el.setAttribute("transform", `rotate(${deg} 2.1 -2.65)`);
    };
    rot("clk-h", (h % 12) * 30 + m * 0.5);
    rot("clk-m", m * 6 + s * 0.1);
    rot("clk-s", s * 6);
  }

  window.OfficeScene = { build, update, setClock, esc };
})();
