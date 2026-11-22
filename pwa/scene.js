/* BOLO HQ — isometric "dollhouse" office (pure SVG, no dependencies).
 *
 * Visual reference: chibi 3D isometric office (white walls, big window with blinds,
 * black/white desks with yellow handles, dual monitors, mustard chairs, beanbag, oval coffee
 * table, rug + cushion, shelf with trailing plant, water dispenser, frames, acoustic panel).
 *
 * Ambient day → night cycle driven by ONE variable `tod` (0 → 1, loop LOOP_MS): JS derives a few
 * weights and writes them as CSS custom properties on the scene root (~20×/s); lit elements read
 * `opacity: var(--…)`, so the SVG is never re-rendered.
 * Agent status (working / idle / offline) is 100% driven by live data through update().
 *
 * Public API (used by app.js, unchanged): build(sceneWrap, agents, onSelect), update(agent, selected),
 * chipPos(agentId), setClock(hhmm, dateLine), esc.
 */
(function () {
  "use strict";

  const LOOP_MS = 10000;
  const VB = { w: 870, h: 690 };
  const T = 40, C = 0.8660254 * T, S = 0.5 * T, OX = 400, OY = 210;
  const RX = 12, RY = 10, WALL = 4.2, SLAB = 0.35;

  const iso = (x, y, z = 0) => [OX + (x - y) * C, OY + (x + y) * S - z * T];
  const pt = (p) => p.map((n) => n.toFixed(1)).join(",");
  const P = (arr) => arr.map((a) => pt(iso(...a))).join(" ");
  const poly = (arr, fill, extra = "") => `<polygon points="${P(arr)}" fill="${fill}" ${extra}/>`;
  const v = (name) => `style="opacity:var(--${name})"`;
  const NS = 'vector-effect="non-scaling-stroke"';
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // plane transforms (draw flat in world units)
  const M_FLOOR = (z = 0) => `matrix(${C},${S},${-C},${S},${OX},${OY - z * T})`;    // local (x, y)
  const M_X = (x0) => `matrix(${-C},${S},0,${T},${OX + x0 * C},${OY + x0 * S})`;     // plane x=x0, local (y, -z)
  const M_Y = (y0) => `matrix(${C},${S},0,${T},${OX - y0 * C},${OY + y0 * S})`;      // plane y=y0, local (x, -z)

  // box with the three visible faces: top, +y face ("front-left"), +x face ("front-right")
  function box(x, y, z, w, d, h, top, fy, fx, extra = "") {
    return (
      poly([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]], fy, extra) +
      poly([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]], fx, extra) +
      poly([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]], top, extra)
    );
  }

  // ------------------------------------------------------------------ palette
  const K = {
    backdrop: "#24272d",
    wallL: "#f3f3f1", wallR: "#e8e8e5", wallCap: "#d9d9d5", wallEnd: "#c9c9c5",
    floor: "#dcdcd8", floorLine: "#cfcfcb", slabY: "#9b9b97", slabX: "#85857f",
    topW: "#f8f8f6", topWy: "#e6e6e2", topWx: "#d9d9d4",
    blk: "#2b2c30", blkY: "#202125", blkX: "#18191c",
    yel: "#f2c230", yelD: "#d6a51c", yelL: "#ffd95a",
    mon: "#17181b",
  };

  // ------------------------------------------------------------------ slots (4 desks + beanbag)
  // kind L: desk against the left (window) wall, person faces the window.
  // kind R: desk against the right wall, person faces the wall.  kind B: beanbag, faces the viewer.
  const SLOTS = [
    { kind: "L", y0: 1.0, cx: 2.3, cy: 2.4 },
    { kind: "L", y0: 4.9, cx: 2.3, cy: 6.3 },
    { kind: "R", x0: 4.4, cx: 5.8, cy: 2.3 },
    { kind: "R", x0: 8.0, cx: 9.4, cy: 2.3 },
    { kind: "B", cx: 4.7, cy: 8.1 },
  ];
  SLOTS.forEach((s) => {
    const [px, py] = iso(s.cx, s.cy, 0);
    s.px = px; s.py = py;
    const headTop = s.kind === "B" ? 92 : 112;
    s.chip = { left: +((px / VB.w) * 100).toFixed(2), top: +(((py - headTop) / VB.h) * 100).toFixed(2) };
  });

  // per-agent look (hair style + accessory) — colours come from agents.json (shirt/skin/hair)
  const LOOKS = {
    bolo_airdrop: { style: "bun", acc: "headphones" },
    bolongonten: { style: "long", acc: "headphones" },
    "hunter-2": { style: "spiky", acc: "hood" },
    "mas-wowo": { style: "short", acc: "glasses" },
    "mas-wiwi": { style: "short", acc: "beanie" },
  };

  // ------------------------------------------------------------------ room shell
  function windowSVG() {
    // left wall (plane x=0), local u = y (0..RY), v = -z
    const u0 = 0.7, u1 = 8.9, vt = -3.75, vb = -1.05, w = u1 - u0, h = vb - vt;
    const panes = 4, pw = w / panes;
    let city = "", cityNight = "", lit = "";
    const B = [[0.0, 0.55, 1.25], [0.6, 0.45, 1.75], [1.1, 0.7, 1.05], [1.85, 0.5, 2.05], [2.4, 0.65, 1.45], [3.1, 0.55, 1.9], [3.7, 0.7, 1.2], [4.45, 0.5, 2.15], [5.0, 0.7, 1.5], [5.75, 0.55, 1.85], [6.35, 0.6, 1.3], [7.0, 0.55, 1.95], [7.6, 0.6, 1.4]];
    B.forEach(([o, bw, bh], i) => {
      const x = u0 + o, top = vb - bh;
      city += `<rect x="${x}" y="${top}" width="${bw}" height="${bh}" fill="${i % 2 ? "#c9d4e1" : "#b7c5d6"}"/>`;
      city += `<rect x="${x + bw * 0.62}" y="${top}" width="${bw * 0.38}" height="${bh}" fill="#a7b6c9" opacity=".6"/>`;
      cityNight += `<rect x="${x}" y="${top}" width="${bw}" height="${bh}" fill="${i % 2 ? "#141b2e" : "#1a2238"}"/>`;
      for (let r = 0; r < Math.floor(bh / 0.2) - 1; r++)
        for (let c = 0; c < Math.floor(bw / 0.14); c++) {
          if ((i * 7 + r * 3 + c * 5) % 3 === 0) continue;
          const on = (i + r * 2 + c) % 3 !== 1;
          const wx = (x + 0.05 + c * 0.14).toFixed(2), wy = (top + 0.1 + r * 0.2).toFixed(2);
          city += `<rect x="${wx}" y="${wy}" width="0.07" height="0.09" fill="#8fa0b6" opacity=".55"/>`;
          if (on) lit += `<rect class="${(i + r + c) % 5 ? "" : "citylit"}" x="${wx}" y="${wy}" width="0.07" height="0.09" fill="#ffd27a"/>`;
        }
    });
    const trees = [0.3, 1.0, 1.7, 2.6, 3.5, 4.2, 5.2, 6.1, 6.9, 7.8].map((o, i) => `<ellipse cx="${u0 + o}" cy="${vb - 0.12}" rx="${0.32 + (i % 3) * 0.06}" ry="${0.22 + (i % 2) * 0.06}" fill="${i % 2 ? "#5f9c55" : "#4d8a47"}"/>`).join("");
    const stars = [[0.6, -3.5], [1.7, -3.3], [2.9, -3.55], [4.1, -3.2], [5.3, -3.45], [6.6, -3.3], [7.8, -3.5], [3.5, -2.95]].map(([a, b], i) => `<circle class="star" cx="${u0 + a}" cy="${b}" r="0.035" fill="#e6efff" style="animation-delay:${i * 0.5}s"/>`).join("");
    let mull = "";
    for (let i = 1; i < panes; i++) mull += `<rect x="${u0 + i * pw - 0.04}" y="${vt}" width="0.08" height="${h}" fill="#2a2b2f"/>`;
    let slats = "";
    for (let i = 0; i < 6; i++) slats += `<rect x="${u0}" y="${vt + i * 0.07}" width="${w}" height="0.045" fill="${i % 2 ? "#33353a" : "#2a2c30"}"/>`;
    return `<g transform="${M_X(0.01)}">
      <clipPath id="winClip"><rect x="${u0}" y="${vt}" width="${w}" height="${h}"/></clipPath>
      <g clip-path="url(#winClip)">
        <rect x="${u0}" y="${vt}" width="${w}" height="${h}" fill="url(#skyNight)"/>
        <g ${v("night")}>${stars}<circle cx="${u0 + 1.2}" cy="-3.25" r="0.2" fill="#eef3ff"/><circle cx="${u0 + 1.13}" cy="-3.3" r="0.18" fill="#16234a"/></g>
        <rect x="${u0}" y="${vt}" width="${w}" height="${h}" fill="url(#skyDusk)" ${v("dusk")}/>
        <rect x="${u0}" y="${vt}" width="${w}" height="${h}" fill="url(#skyGold)" ${v("gold")}/>
        <g ${v("day")}>
          <rect x="${u0}" y="${vt}" width="${w}" height="${h}" fill="url(#skyDay)"/>
          <g fill="#fff" opacity=".92"><ellipse cx="${u0 + 1.6}" cy="-3.2" rx="0.55" ry="0.16"/><ellipse cx="${u0 + 1.9}" cy="-3.3" rx="0.35" ry="0.17"/>
          <ellipse cx="${u0 + 5.4}" cy="-3.0" rx="0.65" ry="0.15"/><ellipse cx="${u0 + 5.7}" cy="-3.1" rx="0.38" ry="0.16"/><ellipse cx="${u0 + 7.4}" cy="-3.4" rx="0.45" ry="0.12"/></g>
        </g>
        <g>${city}</g>
        <g ${v("night")}>${cityNight}</g>
        <g ${v("lamp")}>${lit}</g>
        <g style="opacity:calc(1 - var(--night) * .75)">${trees}</g>
        <polygon points="${u0 + 0.6},${vt} ${u0 + 1.3},${vt} ${u0 + 0.2},${vb} ${u0 - 0.5},${vb}" fill="#fff" style="opacity:calc(.07 + var(--night) * .09)"/>
        <polygon points="${u0 + 4.6},${vt} ${u0 + 4.9},${vt} ${u0 + 3.8},${vb} ${u0 + 3.5},${vb}" fill="#fff" style="opacity:calc(.05 + var(--night) * .07)"/>
        ${slats}
      </g>
      ${mull}
      <rect x="${u0}" y="${vt}" width="${w}" height="${h}" fill="none" stroke="#2a2b2f" stroke-width="5" ${NS}/>
      <rect x="${u0 - 0.06}" y="${vb}" width="${w + 0.12}" height="0.1" fill="#d5d5d1"/>
    </g>`;
  }

  function rightWallDecor() {
    // plane y=0, local u = x, v = -z
    let s = `<g transform="${M_Y(0.01)}">`;
    s += `<rect x="4.55" y="-3.55" width="0.62" height="0.62" fill="#fff" stroke="#1c1d20" stroke-width="3" ${NS}/><rect x="4.7" y="-3.4" width="0.32" height="0.32" fill="#f2c230"/>`;
    s += `<rect x="4.55" y="-2.75" width="0.62" height="0.62" fill="#fff" stroke="#1c1d20" stroke-width="3" ${NS}/><rect x="4.68" y="-2.62" width="0.36" height="0.36" fill="#3a3b40"/>`;
    s += `<rect x="5.7" y="-3.65" width="2.4" height="1.5" fill="#fafafa" stroke="#1c1d20" stroke-width="3.5" ${NS}/>`;
    s += `<rect x="5.88" y="-3.48" width="0.75" height="1.16" fill="#e7e7e7"/><polygon points="5.88,-2.32 6.15,-2.9 6.33,-2.66 6.48,-2.98 6.63,-2.32" fill="#55575e"/>`;
    s += `<rect x="6.78" y="-3.48" width="0.5" height="1.16" fill="#ececec"/><g fill="#9a9ca3">${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="6.83" y="${-3.38 + i * 0.17}" width="0.4" height="0.05"/>`).join("")}</g>`;
    s += `<rect x="7.4" y="-3.2" width="0.52" height="0.6" fill="#f2c230"/>`;
    s += `<rect x="2.7" y="-3.55" width="1.2" height="0.62" rx="0.08" fill="#16181d"/>`;
    s += `<text id="wallClock" x="3.3" y="-3.12" text-anchor="middle" font-family="JetBrains Mono, monospace" font-weight="700" font-size="0.36" fill="#7ee2fc">--:--</text>`;
    s += `<text id="wallDate" x="3.3" y="-2.99" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="0.1" fill="#6b84a6">WIB</text>`;
    s += `<rect x="10.35" y="-3.7" width="1.25" height="1.9" fill="#1d1e22"/>`;
    for (let i = 0; i < 9; i++) s += `<rect x="${10.42 + i * 0.13}" y="-3.62" width="0.07" height="1.74" fill="#2c2d32"/>`;
    s += `<rect x="8.45" y="-3.6" width="1.5" height="1.0" fill="#c99a62" stroke="#8a5a32" stroke-width="2.5" ${NS}/>`;
    [["#f4b8c1", 8.55, -3.5], ["#a7e8bd", 8.95, -3.48], ["#ffe08a", 9.38, -3.5], ["#a5d8ff", 8.6, -3.1], ["#ffc9a3", 9.05, -3.08], ["#d0bfff", 9.45, -3.12]].forEach(([c, x, y]) => (s += `<rect x="${x}" y="${y}" width="0.36" height="0.32" fill="${c}"/>`));
    s += `<text x="9.2" y="-2.66" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="0.1" font-weight="700" fill="#5b3a1c">PIPELINE</text>`;
    return s + `</g>`;
  }

  function shell() {
    let s = "";
    s += poly([[0, RY, 0], [RX, RY, 0], [RX, RY, -SLAB], [0, RY, -SLAB]], K.slabY);
    s += poly([[RX, 0, 0], [RX, RY, 0], [RX, RY, -SLAB], [RX, 0, -SLAB]], K.slabX);
    s += poly([[0, 0, 0], [0, RY, 0], [0, RY, WALL], [0, 0, WALL]], K.wallL);
    s += poly([[0, 0, 0], [RX, 0, 0], [RX, 0, WALL], [0, 0, WALL]], K.wallR);
    s += poly([[0, 0, 0], [0, RY, 0], [0, RY, 0.12], [0, 0, 0.12]], "#cfcfcb");
    s += poly([[0, 0, 0], [RX, 0, 0], [RX, 0, 0.12], [0, 0, 0.12]], "#c5c5c1");
    s += poly([[-0.3, -0.3, WALL], [0, 0, WALL], [0, RY, WALL], [-0.3, RY, WALL]], K.wallCap);
    s += poly([[-0.3, -0.3, WALL], [RX, -0.3, WALL], [RX, 0, WALL], [0, 0, WALL]], K.wallCap);
    s += poly([[-0.3, RY, -SLAB], [0, RY, -SLAB], [0, RY, WALL], [-0.3, RY, WALL]], K.wallEnd);
    s += poly([[RX, -0.3, -SLAB], [RX, 0, -SLAB], [RX, 0, WALL], [RX, -0.3, WALL]], "#b9b9b5");
    s += `<g transform="${M_FLOOR()}"><rect x="0" y="0" width="${RX}" height="${RY}" fill="${K.floor}"/>`;
    for (let i = 2; i < RX; i += 2) s += `<line x1="${i}" y1="0" x2="${i}" y2="${RY}" stroke="${K.floorLine}" stroke-width="1" ${NS}/>`;
    for (let j = 2; j < RY; j += 2) s += `<line x1="0" y1="${j}" x2="${RX}" y2="${j}" stroke="${K.floorLine}" stroke-width="1" ${NS}/>`;
    s += `<g style="opacity:calc(var(--day) * .55)" fill="#ffffff">
        <polygon points="0,1.0 0,2.9 4.6,4.4 4.6,2.5"/><polygon points="0,3.3 0,5.2 4.6,6.7 4.6,4.8"/><polygon points="0,5.6 0,7.5 4.6,9.0 4.6,7.1"/></g>
      <g style="opacity:calc(var(--gold) * .6 + var(--dusk) * .2)" fill="#ffc27a">
        <polygon points="0,1.0 0,2.9 7.2,5.5 7.2,3.6"/><polygon points="0,3.3 0,5.2 7.2,7.8 7.2,5.9"/><polygon points="0,5.6 0,7.5 6.2,9.9 6.2,8.0"/></g>`;
    s += `</g>`;
    s += windowSVG();
    s += rightWallDecor();
    return s;
  }

  // ------------------------------------------------------------------ furniture
  function shelfUnit() {
    let s = box(0.35, 0.05, 0, 2.0, 0.75, 3.5, "#3a3b40", K.blk, K.blkX);
    s += `<g transform="${M_Y(0.8)}">`;
    [[-3.35, -2.75], [-2.6, -2.0]].forEach(([a, b]) => (s += `<rect x="0.45" y="${a}" width="1.8" height="${b - a}" fill="#b48a5a"/>`));
    s += `<rect x="0.45" y="-1.85" width="1.8" height="0.5" fill="#b48a5a"/>`;
    const books = [["#f2f2f2", 0.5, 0.12, 0.5], ["#e9e9e9", 0.64, 0.1, 0.46], ["#f2c230", 0.76, 0.1, 0.52], ["#fafafa", 0.9, 0.14, 0.42], ["#2b2c30", 1.08, 0.12, 0.5]];
    books.forEach(([c, x, w, h]) => (s += `<rect x="${x}" y="${-2.75 - h}" width="${w}" height="${h}" fill="${c}"/>`));
    s += `<rect x="1.4" y="-3.2" width="0.5" height="0.42" fill="#fff" stroke="#2b2c30" stroke-width="2" ${NS}/><rect x="1.48" y="-3.12" width="0.34" height="0.26" fill="#c6d3df"/>`;
    s += `<rect x="0.55" y="-2.27" width="0.6" height="0.27" fill="#f4f4f2"/><rect x="0.55" y="-2.4" width="0.6" height="0.12" fill="#e2e2df"/>`;
    s += `<rect x="1.35" y="-2.4" width="0.18" height="0.4" fill="#f2c230"/><rect x="1.56" y="-2.36" width="0.14" height="0.36" fill="#fff"/>`;
    s += `<rect x="1.85" y="-2.33" width="0.3" height="0.33" rx="0.05" fill="#3f9e63"/>`;
    s += `<rect x="0.55" y="-1.8" width="0.7" height="0.42" fill="#f6f6f4"/><rect x="1.4" y="-1.75" width="0.25" height="0.37" fill="#e9e9e6"/>`;
    s += `<rect x="0.45" y="-1.25" width="0.88" height="1.15" fill="#25262a"/><rect x="1.37" y="-1.25" width="0.88" height="1.15" fill="#25262a"/>`;
    s += `<rect x="1.2" y="-0.85" width="0.05" height="0.28" fill="${K.yel}"/><rect x="1.45" y="-0.85" width="0.05" height="0.28" fill="${K.yel}"/>`;
    s += `</g>`;
    const [px, py] = iso(1.2, 0.45, 3.5);
    s += box(0.95, 0.2, 3.5, 0.5, 0.45, 0.35, "#e9e9e6", "#d5d5d1", "#c5c5c1");
    s += `<g class="vine">
      <path d="M${px - 4},${py - 10} c-14,10 -18,40 -12,74 c4,24 -4,46 -2,66" stroke="#3f8f55" stroke-width="2.4" fill="none"/>
      <path d="M${px + 10},${py - 8} c10,18 14,44 8,70" stroke="#357a49" stroke-width="2.4" fill="none"/>
      ${[[-10, 6], [-16, 26], [-14, 46], [-15, 66], [-11, 88], [-14, 110], [14, 10], [20, 30], [21, 50], [17, 66]].map(([dx, dy], i) => `<ellipse cx="${px + dx}" cy="${py + dy}" rx="6.5" ry="3.8" fill="${i % 2 ? "#3f9e63" : "#4cae6e"}" transform="rotate(${i % 2 ? 28 : -28} ${px + dx} ${py + dy})"/>`).join("")}
      ${[[-12, -20], [0, -26], [12, -20], [-4, -14], [8, -12], [-18, -10], [18, -8]].map(([dx, dy], i) => `<ellipse cx="${px + dx}" cy="${py + dy}" rx="10" ry="6" fill="${i % 2 ? "#3f9e63" : "#56b877"}" transform="rotate(${dx} ${px + dx} ${py + dy})"/>`).join("")}
    </g>`;
    return s;
  }

  function dispenser() {
    let s = box(2.75, 0.15, 0, 0.75, 0.7, 1.75, "#f4f4f2", "#eaeae7", "#d8d8d4");
    s += `<g transform="${M_Y(0.86)}"><rect x="2.85" y="-1.42" width="0.55" height="0.5" fill="#e0e0dc"/><rect x="2.95" y="-1.3" width="0.12" height="0.12" fill="#3b82f6"/><rect x="3.18" y="-1.3" width="0.12" height="0.12" fill="#ef4444"/><rect x="2.85" y="-0.6" width="0.55" height="0.06" fill="#b9b9b5"/></g>`;
    const [bx, by] = iso(3.12, 0.5, 1.75);
    s += `<g><rect x="${bx - 16}" y="${by - 44}" width="32" height="40" rx="9" fill="#6fb3ea"/><rect x="${bx - 12}" y="${by - 40}" width="7" height="32" rx="3.5" fill="#d7ecfb" opacity=".7"/>
      <ellipse cx="${bx}" cy="${by - 44}" rx="16" ry="5" fill="#8cc6f2"/>${[0, 1, 2].map((i) => `<rect x="${bx - 16}" y="${by - 34 + i * 10}" width="32" height="2" fill="#4f9bd6" opacity=".6"/>`).join("")}
      <ellipse cx="${bx}" cy="${by - 4}" rx="16" ry="5" fill="#5aa3dd"/></g>`;
    return s;
  }

  function printerCabinet() {
    let s = box(10.5, 0.15, 0, 1.3, 0.8, 1.0, "#3a3b40", K.blk, K.blkX);
    s += `<g transform="${M_Y(0.96)}"><rect x="10.6" y="-0.9" width="0.52" height="0.8" fill="#25262a"/><rect x="11.18" y="-0.9" width="0.52" height="0.8" fill="#25262a"/><rect x="11.05" y="-0.6" width="0.04" height="0.2" fill="${K.yel}"/><rect x="11.22" y="-0.6" width="0.04" height="0.2" fill="${K.yel}"/></g>`;
    s += box(10.7, 0.3, 1.0, 0.9, 0.55, 0.32, "#4a4c52", "#3a3c42", "#2e3035");
    s += box(10.8, 0.38, 1.32, 0.7, 0.35, 0.04, "#f8f8f6", "#e2e2df", "#d3d3cf");
    return s;
  }

  function plant(x, y, scale = 1) {
    let s = box(x - 0.32 * scale, y - 0.32 * scale, 0, 0.64 * scale, 0.64 * scale, 0.6 * scale, "#f4f4f2", "#e7e7e4", "#d6d6d2");
    const [px, py] = iso(x, y, 0.6 * scale);
    s += `<ellipse cx="${px}" cy="${py}" rx="${18 * scale}" ry="${8 * scale}" fill="#4b3a2a"/>`;
    s += `<g class="sway" style="transform-origin:${px}px ${py}px">`;
    const L = [[-26, -30, -40], [24, -34, 38], [-8, -58, -8], [10, -54, 14], [-34, -12, -62], [34, -14, 62], [0, -40, 0], [-18, -46, -24], [20, -48, 26]];
    L.forEach(([dx, dy, r], i) => (s += `<ellipse cx="${px + dx * 0.55 * scale}" cy="${py + dy * 0.62 * scale}" rx="${7 * scale}" ry="${19 * scale}" fill="${i % 3 === 0 ? "#2f7d46" : i % 3 === 1 ? "#3f9e5a" : "#56b46e"}" transform="rotate(${r} ${px + dx * 0.55 * scale} ${py + dy * 0.62 * scale})"/>`));
    return s + `</g>`;
  }

  function lounge() {
    let s = "";
    s += `<g transform="${M_FLOOR()}"><ellipse cx="9.9" cy="6.5" rx="1.6" ry="1.45" fill="#2c2d31"/><ellipse cx="9.9" cy="6.5" rx="1.4" ry="1.26" fill="none" stroke="#3d3e43" stroke-width="2" ${NS} stroke-dasharray="3 3"/></g>`;
    s += box(9.25, 5.95, 0, 1.3, 1.1, 0.28, "#f6f3ea", "#e6e1d4", "#d8d2c3");
    const [cx, cy] = iso(9.9, 6.5, 0.28);
    s += `<path d="M${cx - 30},${cy} q30,-8 60,0" stroke="#e2dccc" stroke-width="1.5" fill="none"/><circle cx="${cx}" cy="${cy}" r="2.5" fill="#d6cfbd"/>`;
    return s;
  }

  function coffeeTable() {
    const [x, y] = [7.0, 6.6];
    let s = `<g transform="${M_FLOOR()}"><ellipse cx="${x + 0.15}" cy="${y + 0.15}" rx="1.35" ry="0.78" fill="#000" opacity=".12"/></g>`;
    [[-0.8, -0.3], [0.8, 0.3], [-0.3, 0.45], [0.35, -0.45]].forEach(([dx, dy]) => (s += box(x + dx - 0.06, y + dy - 0.06, 0, 0.12, 0.12, 0.5, "#2a2b2f", "#1f2023", "#17181b")));
    s += `<g transform="${M_FLOOR(0.5)}"><ellipse cx="${x}" cy="${y}" rx="1.3" ry="0.75" fill="#1c1d21"/></g>`;
    s += `<g transform="${M_FLOOR(0.58)}"><ellipse cx="${x}" cy="${y}" rx="1.3" ry="0.75" fill="#303136"/>
      <rect x="${x - 0.75}" y="${y - 0.05}" width="0.6" height="0.45" fill="#f7f7f5" transform="rotate(-12 ${x - 0.45} ${y + 0.17})"/>
      <rect x="${x - 0.68}" y="${y + 0.02}" width="0.46" height="0.04" fill="#9a9ca3"/><rect x="${x - 0.68}" y="${y + 0.12}" width="0.4" height="0.04" fill="#9a9ca3"/></g>`;
    s += box(x - 0.05, y - 0.45, 0.58, 0.55, 0.4, 0.1, K.yel, K.yelD, "#c4950f");
    s += box(x - 0.02, y - 0.42, 0.68, 0.5, 0.34, 0.06, "#fff7d6", "#efe3b5", "#e3d39b");
    const [mx, my] = iso(x + 0.7, y + 0.15, 0.58);
    s += `<rect x="${mx - 6}" y="${my - 14}" width="12" height="13" rx="3" fill="#f8f8f6"/><ellipse cx="${mx}" cy="${my - 14}" rx="6" ry="2.2" fill="#6b4a2b"/><path d="M${mx + 6},${my - 11} q6,3 0,8" stroke="#f8f8f6" stroke-width="2" fill="none"/>`;
    const [gx, gy] = iso(x - 0.5, y - 0.35, 0.58);
    s += `<rect x="${gx - 7}" y="${gy - 10}" width="14" height="10" rx="3" fill="#f4f4f2"/><g fill="#4cae6e"><ellipse cx="${gx - 4}" cy="${gy - 15}" rx="4" ry="7" transform="rotate(-25 ${gx - 4} ${gy - 15})"/><ellipse cx="${gx + 4}" cy="${gy - 15}" rx="4" ry="7" transform="rotate(25 ${gx + 4} ${gy - 15})"/><ellipse cx="${gx}" cy="${gy - 18}" rx="3.5" ry="7"/></g>`;
    return s;
  }

  // ------------------------------------------------------------------ people (screen-space chibi)
  function hairBack(style, hair) {
    let s = `<circle cx="2.5" cy="-0.5" r="16.6" fill="${hair}"/>`;
    if (style === "long") s += `<path d="M-12,-2 C-16,14 -12,30 -8,36 L14,36 C18,26 18,10 15,-4 Z" fill="${hair}"/>`;
    if (style === "bun") s += `<circle cx="5" cy="-17" r="7" fill="${hair}"/><circle cx="3" cy="-19" r="2.5" fill="#fff" opacity=".12"/>`;
    if (style === "spiky") s += `<path d="M-12,-10 l4,-12 l5,8 l4,-12 l5,10 l5,-10 l3,12 l5,-6 l-2,14 Z" fill="${hair}"/>`;
    s += `<path d="M-8,-12 q8,-6 18,-3" stroke="#fff" stroke-width="2" opacity=".14" fill="none" stroke-linecap="round"/>`;
    return s;
  }
  function accBack(acc) {
    if (acc === "headphones") return `<path d="M-15,-2 C-16,-24 16,-26 17,-2" stroke="#1d1e22" stroke-width="3.6" fill="none"/><ellipse cx="-14.5" cy="1" rx="4.6" ry="6.4" fill="#1d1e22"/><ellipse cx="-15.5" cy="1" rx="2.2" ry="3.6" fill="#3a3c42"/>`;
    if (acc === "glasses") return `<path d="M-13,1 L-20,-1" stroke="#1d1e22" stroke-width="2"/>`;
    if (acc === "beanie") return `<path d="M-15,-4 C-14,-24 18,-24 18,-2 Z" fill="#2f5d50"/><rect x="-15" y="-6" width="33" height="5" rx="2.5" fill="#24493f"/>`;
    return "";
  }
  function headFront(look, skin, hair, withDownEyes) {
    const st = look.style, acc = look.acc;
    let s = `<circle cx="0" cy="0" r="16" fill="${skin}"/>`;
    s += `<path d="M-16.5,1 C-18,-18 18,-18 16.5,1 C14,-6 8,-9 0,-9 C-8,-9 -14,-6 -16.5,1 Z" fill="${hair}"/>`;
    if (st === "long") s += `<path d="M-16,0 C-19,14 -16,26 -12,30 L-10,4 Z M16,0 C19,14 16,26 12,30 L10,4 Z" fill="${hair}"/>`;
    if (st === "bun") s += `<circle cx="0" cy="-18" r="6.5" fill="${hair}"/>`;
    if (st === "spiky") s += `<path d="M-15,-6 l2,-12 l6,7 l5,-11 l5,10 l6,-9 l1,13 Z" fill="${hair}"/>`;
    s += `<g class="eyes-open"><ellipse cx="-6" cy="2" rx="2.6" ry="3.2" fill="#22180f"/><ellipse cx="6" cy="2" rx="2.6" ry="3.2" fill="#22180f"/><circle cx="-5.2" cy="0.8" r="1" fill="#fff"/><circle cx="6.8" cy="0.8" r="1" fill="#fff"/></g>`;
    if (withDownEyes) s += `<g class="eyes-down"><path d="M-9,3 q3,2.5 6,0 M3,3 q3,2.5 6,0" stroke="#22180f" stroke-width="1.8" fill="none" stroke-linecap="round"/></g>`;
    s += `<ellipse cx="-10" cy="7" rx="3" ry="1.8" fill="#f28b82" opacity=".45"/><ellipse cx="10" cy="7" rx="3" ry="1.8" fill="#f28b82" opacity=".45"/>`;
    s += `<path d="M-3,9 q3,2.6 6,0" stroke="#7a3b22" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
    if (acc === "glasses" || acc === "beanie") s += `<g fill="none" stroke="#1d1e22" stroke-width="1.6"><circle cx="-6" cy="2" r="5"/><circle cx="6" cy="2" r="5"/><path d="M-1,2 h2"/></g>`;
    if (acc === "headphones") s += `<path d="M-16,0 C-17,-24 17,-24 16,0" stroke="#1d1e22" stroke-width="3.6" fill="none"/><ellipse cx="-16.5" cy="3" rx="4.2" ry="6" fill="#1d1e22"/><ellipse cx="16.5" cy="3" rx="4.2" ry="6" fill="#1d1e22"/>`;
    if (acc === "beanie") s += `<path d="M-17,-1 C-17,-24 17,-24 17,-1 Z" fill="#2f5d50"/><rect x="-17.5" y="-4" width="35" height="6" rx="3" fill="#24493f"/>`;
    return s;
  }

  // Seated at a desk, facing up-left (kind L). Kind R is the same drawing mirrored.
  function deskPerson(a, look) {
    const shirt = a.shirt || a.color || "#64748b", skin = a.skin || "#e0ac7e", hair = a.hair || "#2a1a10";
    const hood = look.acc === "hood" ? `<path d="M-12,-60 C-16,-74 -4,-82 10,-76 C16,-72 16,-62 12,-58 Z" fill="${shirt}"/><path d="M-10,-60 C-12,-70 -2,-76 8,-72" stroke="#000" stroke-opacity=".18" stroke-width="2" fill="none"/>` : "";
    return `
      <ellipse class="focusring" cx="0" cy="2" rx="44" ry="20" fill="none" stroke="${esc(a.color || "#e8590c")}" stroke-width="2.5" stroke-dasharray="7 6"/>
      <ellipse cx="0" cy="2" rx="24" ry="9" fill="#000" opacity=".16"/>
      <g stroke="#1d1e21" stroke-width="3" stroke-linecap="round"><path d="M0,0 l-14,4 M0,0 l14,4 M0,0 l-6,-7 M0,0 l8,-6 M0,0 l0,8"/></g>
      <rect x="-2.2" y="-22" width="4.4" height="22" fill="#2b2c30"/>
      <ellipse cx="-1" cy="-24" rx="21" ry="9" fill="${K.yelD}"/><ellipse cx="-1" cy="-26" rx="20" ry="8" fill="${K.yel}"/>
      <g class="char">
        <g class="hands">
          <path d="M-10,-48 L-30,-52" stroke="${shirt}" stroke-width="7.5" stroke-linecap="round"/>
          <path d="M5,-48 L-18,-58" stroke="${shirt}" stroke-width="7.5" stroke-linecap="round"/>
          <circle class="hand-l" cx="-31" cy="-52" r="4.2" fill="${skin}"/><circle class="hand-r" cx="-19" cy="-59" r="4.2" fill="${skin}"/>
        </g>
        <rect x="-16" y="-62" width="28" height="38" rx="12" fill="${shirt}"/>
        <rect x="-2" y="-62" width="14" height="38" rx="9" fill="#000" opacity=".14"/>
        ${hood}
        <g class="head" transform="translate(-3,-80)">
          <g class="head-back">
            <circle cx="0" cy="0" r="16" fill="${skin}"/>
            <ellipse cx="-14.6" cy="2" rx="3.2" ry="4.4" fill="${skin}"/>
            ${hairBack(look.style, hair)}
            ${accBack(look.acc)}
          </g>
          <g class="head-face">${headFront(look, skin, hair, false)}</g>
        </g>
      </g>
      <path d="M2,-22 C2,-40 10,-56 22,-60 C28,-58 30,-48 28,-36 C26,-24 18,-18 8,-16 Z" fill="${K.yel}"/>
      <path d="M8,-20 C10,-36 16,-50 24,-54" stroke="${K.yelL}" stroke-width="3" fill="none" stroke-linecap="round" opacity=".8"/>
      <path d="M24,-30 C26,-22 22,-16 14,-14" stroke="${K.yelD}" stroke-width="3" fill="none"/>`;
  }

  function beanbagPerson(a, look) {
    const shirt = a.shirt || a.color || "#64748b", skin = a.skin || "#e0ac7e", hair = a.hair || "#2a1a10";
    return `
      <ellipse class="focusring" cx="0" cy="4" rx="56" ry="24" fill="none" stroke="${esc(a.color || "#e8590c")}" stroke-width="2.5" stroke-dasharray="7 6"/>
      <ellipse cx="2" cy="4" rx="44" ry="16" fill="#000" opacity=".16"/>
      <path d="M-44,-6 C-50,-30 -30,-58 0,-60 C30,-62 52,-36 46,-8 C42,10 -38,12 -44,-6 Z" fill="${K.yel}"/>
      <path d="M-36,-14 C-34,-40 -12,-52 10,-50" stroke="${K.yelL}" stroke-width="5" fill="none" stroke-linecap="round" opacity=".7"/>
      <path d="M-40,-2 C-20,10 24,10 42,-4" stroke="${K.yelD}" stroke-width="4" fill="none"/>
      <g class="char">
        <path d="M-6,-18 L-26,4" stroke="#2f3a4f" stroke-width="10" stroke-linecap="round"/><path d="M8,-16 L-4,8" stroke="#2f3a4f" stroke-width="10" stroke-linecap="round"/>
        <ellipse cx="-29" cy="7" rx="7" ry="4.5" fill="#f2f2f0"/><ellipse cx="-6" cy="11" rx="7" ry="4.5" fill="#f2f2f0"/>
        <rect x="-15" y="-52" width="30" height="36" rx="13" fill="${shirt}"/>
        <rect x="2" y="-52" width="13" height="36" rx="9" fill="#000" opacity=".13"/>
        <g class="head" transform="translate(0,-66)"><g class="bb-head">${headFront(look, skin, hair, true)}</g></g>
        <g class="laptop">
          <polygon points="-22,-14 18,-20 22,-44 -18,-38" fill="#c8ccd3"/>
          <polygon points="-22,-14 18,-20 19,-23 -21,-17" fill="#aeb3bb"/>
          <circle cx="0" cy="-30" r="3" fill="#e9ecf0"/>
        </g>
        <g class="hands"><circle class="hand-l" cx="-20" cy="-16" r="4.2" fill="${skin}"/><circle class="hand-r" cx="17" cy="-21" r="4.2" fill="${skin}"/></g>
      </g>`;
  }

  // ------------------------------------------------------------------ desks
  function monitorScreens(u0, isCode) {
    const z0 = -1.6, z1 = -1.12, w = 0.78;
    let s = `<rect x="${u0 + 0.04}" y="${z0}" width="${w}" height="${z1 - z0}" fill="#0f1013"/>`;
    if (isCode) {
      s += `<g class="screen-on"><rect x="${u0 + 0.04}" y="${z0}" width="${w}" height="${z1 - z0}" fill="#14232c"/>`;
      ["#4ade80", "#7ee2fc", "#fbbf24", "#4ade80", "#c4b5fd"].forEach((c, i) => (s += `<rect class="code-line" x="${u0 + 0.1 + (i % 2) * 0.06}" y="${z0 + 0.06 + i * 0.085}" width="${[0.42, 0.55, 0.3, 0.48, 0.36][i]}" height="0.04" fill="${c}" style="animation-delay:${i * 0.4}s"/>`));
      s += `</g>`;
    } else {
      s += `<g class="screen-on"><rect x="${u0 + 0.04}" y="${z0}" width="${w}" height="${z1 - z0}" fill="#eef5ff"/>
        <rect x="${u0 + 0.04}" y="${z0}" width="${w}" height="0.07" fill="#2563eb"/>
        <rect x="${u0 + 0.09}" y="${z0 + 0.12}" width="0.32" height="0.14" fill="#bfdbfe"/><rect x="${u0 + 0.45}" y="${z0 + 0.12}" width="0.32" height="0.14" fill="#93c5fd"/>
        <rect x="${u0 + 0.09}" y="${z0 + 0.3}" width="0.68" height="0.05" fill="#cbd5e1"/><rect x="${u0 + 0.09}" y="${z0 + 0.38}" width="0.5" height="0.05" fill="#cbd5e1"/></g>`;
    }
    return s;
  }

  function deskL(sl, a, look) {
    const y0 = sl.y0;
    let back = "";
    back += box(0.2, y0 + 0.05, 0, 1.3, 0.1, 0.85, K.blk, K.blkY, K.blkX);
    back += box(0.2, y0 + 2.0, 0, 1.3, 0.72, 0.85, K.blk, K.blkY, K.blkX);
    back += `<g transform="${M_X(1.51)}">${[0, 1, 2].map((i) => `<rect x="${y0 + 2.05}" y="${-0.8 + i * 0.27}" width="0.62" height="0.24" fill="#232428"/><rect x="${y0 + 2.26}" y="${-0.71 + i * 0.27}" width="0.2" height="0.04" fill="${K.yel}"/>`).join("")}</g>`;
    back += box(0.12, y0, 0.85, 1.5, 2.8, 0.1, K.topW, K.topWy, K.topWx);
    [[y0 + 0.45, true], [y0 + 1.4, false]].forEach(([u, isCode]) => {
      back += box(0.38, u + 0.33, 0.95, 0.12, 0.2, 0.16, "#2b2c30", "#202125", "#17181b");
      back += box(0.32, u, 1.06, 0.08, 0.86, 0.6, "#2b2c30", "#1c1d20", K.mon);
      back += `<g transform="${M_X(0.405)}">${monitorScreens(u, isCode)}</g>`;
    });
    back += `<g transform="${M_FLOOR(0.96)}"><rect x="0.95" y="${y0 + 0.75}" width="0.32" height="0.85" rx="0.04" fill="#2b2c30"/><rect x="1.0" y="${y0 + 1.75}" width="0.2" height="0.14" rx="0.05" fill="#2b2c30"/>
      <rect x="0.5" y="${y0 + 0.08}" width="0.55" height="0.38" fill="${K.yel}" transform="rotate(8 0.77 ${y0 + 0.27})"/></g>`;
    back += mugAt(1.15, y0 + 2.35, 0.95);
    back += lampAt(0.45, y0 + 2.5, 0.95, "L");
    back += awayAt(1.2, y0 + 1.25, 0.95);
    return { back, person: deskPerson(a, look) };
  }

  function deskR(sl, a, look) {
    const x0 = sl.x0;
    let back = "";
    back += box(x0 + 0.05, 0.2, 0, 0.1, 1.3, 0.85, K.blk, K.blkY, K.blkX);
    back += box(x0 + 2.0, 0.2, 0, 0.72, 1.3, 0.85, K.blk, K.blkY, K.blkX);
    back += `<g transform="${M_Y(1.51)}">${[0, 1, 2].map((i) => `<rect x="${x0 + 2.05}" y="${-0.8 + i * 0.27}" width="0.62" height="0.24" fill="#232428"/><rect x="${x0 + 2.26}" y="${-0.71 + i * 0.27}" width="0.2" height="0.04" fill="${K.yel}"/>`).join("")}</g>`;
    back += box(x0, 0.12, 0.85, 2.8, 1.5, 0.1, K.topW, K.topWy, K.topWx);
    [[x0 + 0.45, true], [x0 + 1.4, false]].forEach(([u, isCode]) => {
      back += box(u + 0.33, 0.38, 0.95, 0.2, 0.12, 0.16, "#2b2c30", "#202125", "#17181b");
      back += box(u, 0.32, 1.06, 0.86, 0.08, 0.6, "#2b2c30", K.mon, "#1c1d20");
      back += `<g transform="${M_Y(0.405)}">${monitorScreens(u, isCode)}</g>`;
    });
    back += `<g transform="${M_FLOOR(0.96)}"><rect x="${x0 + 0.75}" y="0.95" width="0.85" height="0.32" rx="0.04" fill="#2b2c30"/><rect x="${x0 + 1.75}" y="1.0" width="0.14" height="0.2" rx="0.05" fill="#2b2c30"/>
      <rect x="${x0 + 0.08}" y="0.5" width="0.38" height="0.55" fill="#f7f7f5" transform="rotate(-8 ${x0 + 0.27} 0.77)"/></g>`;
    back += mugAt(x0 + 2.35, 1.15, 0.95);
    back += lampAt(x0 + 2.5, 0.45, 0.95, "R");
    back += awayAt(x0 + 1.25, 1.2, 0.95);
    return { back, person: `<g transform="scale(-1,1)">${deskPerson(a, look)}</g>` };
  }

  function mugAt(x, y, z) {
    const [mx, my] = iso(x, y, z);
    return `<g><rect x="${mx - 6}" y="${my - 13}" width="12" height="13" rx="3" fill="#f8f8f6"/><ellipse cx="${mx}" cy="${my - 13}" rx="6" ry="2.2" fill="#6b4a2b"/><path d="M${mx + 6},${my - 10} q6,3 0,7" stroke="#f8f8f6" stroke-width="2" fill="none"/>
      <g class="mug-steam"><path d="M${mx - 2},${my - 17} q-3,-6 0,-11 q3,-5 0,-10" stroke="#cbd5e1" stroke-width="2" fill="none"/><path d="M${mx + 3},${my - 18} q-3,-5 0,-9 q3,-4 0,-8" stroke="#cbd5e1" stroke-width="2" fill="none"/></g></g>`;
  }
  function lampAt(x, y, z, kind) {
    const [lx, ly] = iso(x, y, z);
    const d = kind === "L" ? 1 : -1;
    return `<g class="lamp"><ellipse cx="${lx}" cy="${ly - 2}" rx="9" ry="3.6" fill="#1d1e22"/><path d="M${lx},${ly - 3} L${lx - 6 * d},${ly - 30} L${lx + 10 * d},${ly - 46}" stroke="#1d1e22" stroke-width="3.2" fill="none" stroke-linecap="round"/>
      <path d="M${lx + 4 * d},${ly - 50} L${lx + 22 * d},${ly - 40} L${lx + 14 * d},${ly - 32} Z" fill="${K.yel}"/><path d="M${lx + 22 * d},${ly - 40} L${lx + 14 * d},${ly - 32}" stroke="#fff1c1" stroke-width="3" style="opacity:var(--lamp)"/></g>`;
  }
  function awayAt(x, y, z) {
    const [ax, ay] = iso(x, y, z);
    return `<g class="away"><rect x="${ax - 26}" y="${ay - 20}" width="52" height="18" rx="5" fill="#0f172a" stroke="#475569"/><text x="${ax}" y="${ay - 7}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="10.5" font-weight="700" fill="#94a3b8">AWAY</text></g>`;
  }

  function lightFor(sl) {
    if (sl.kind === "B") {
      return `<g class="screen-light" style="opacity:var(--glow)"><ellipse cx="${sl.px - 2}" cy="${sl.py - 60}" rx="46" ry="34" fill="url(#screenGlow)" style="mix-blend-mode:screen"/></g>`;
    }
    const L = sl.kind === "L";
    const lamp = L ? iso(0.45, sl.y0 + 2.5, 0.95) : iso(sl.x0 + 2.5, 0.45, 0.95);
    const pool = L ? iso(0.9, sl.y0 + 2.1, 0.95) : iso(sl.x0 + 2.1, 0.9, 0.95);
    const scr = L ? iso(0.4, sl.y0 + 1.3, 1.35) : iso(sl.x0 + 1.3, 0.4, 1.35);
    const d = L ? 1 : -1;
    return `<g class="lamp-light" style="opacity:var(--lamp)">
        <circle cx="${lamp[0] + 16 * d}" cy="${lamp[1] - 36}" r="44" fill="url(#lampPool)"/>
        <ellipse cx="${pool[0]}" cy="${pool[1]}" rx="70" ry="30" fill="url(#lampPool)"/>
      </g>
      <g class="screen-light" style="opacity:var(--glow)"><ellipse cx="${scr[0] + 20 * d}" cy="${scr[1] + 6}" rx="78" ry="46" fill="url(#screenGlow)" style="mix-blend-mode:screen"/></g>`;
  }

  // ------------------------------------------------------------------ svg skeleton
  function defs() {
    return `<defs>
      <radialGradient id="stage" cx=".5" cy=".55" r=".7"><stop offset="0" stop-color="#34383f"/><stop offset="1" stop-color="${K.backdrop}"/></radialGradient>
      <linearGradient id="skyNight" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1330"/><stop offset="1" stop-color="#22355f"/></linearGradient>
      <linearGradient id="skyDusk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3d3a7a"/><stop offset=".55" stop-color="#b65f86"/><stop offset="1" stop-color="#f08a5d"/></linearGradient>
      <linearGradient id="skyGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fb4d8"/><stop offset=".5" stop-color="#f6c48a"/><stop offset="1" stop-color="#f59e5b"/></linearGradient>
      <linearGradient id="skyDay" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ec3ee"/><stop offset="1" stop-color="#e3f0fa"/></linearGradient>
      <radialGradient id="lampPool" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffd59a" stop-opacity=".85"/><stop offset=".55" stop-color="#ffb862" stop-opacity=".28"/><stop offset="1" stop-color="#ffb862" stop-opacity="0"/></radialGradient>
      <radialGradient id="screenGlow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#bfe6ff" stop-opacity=".7"/><stop offset="1" stop-color="#7cc4ff" stop-opacity="0"/></radialGradient>
    </defs>`;
  }

  function windowHole() {
    const a = iso(0, 0.7, 3.75), b = iso(0, 8.9, 3.75), c = iso(0, 8.9, 1.05), d = iso(0, 0.7, 1.05);
    return `M${pt(a)} L${pt(b)} L${pt(c)} L${pt(d)} Z`;
  }

  // ------------------------------------------------------------------ build / update
  function build(sceneWrap, agents, onSelect) {
    const objects = [];
    objects.push({ d: 1.6, svg: shelfUnit() });
    objects.push({ d: 3.6, svg: dispenser() });
    objects.push({ d: 11.65, svg: printerCabinet() });
    objects.push({ d: 12.3, svg: plant(11.4, 0.9) });
    objects.push({ d: 10.1, svg: plant(0.8, 9.3, 1.1) });
    objects.push({ d: 20.5, svg: plant(11.3, 9.2, 0.9) });
    objects.push({ d: 14.0, svg: lounge() });
    objects.push({ d: 13.6, svg: coffeeTable() });

    const lights = [];
    const chipList = [];
    agents.forEach((a, i) => {
      const sl = SLOTS[(a.desk ?? i) % SLOTS.length];
      const look = LOOKS[a.agent_id] || { style: ["short", "long", "bun", "spiky"][i % 4], acc: ["glasses", "headphones", "", "hood"][i % 4] };
      let back = "", person;
      if (sl.kind === "L") ({ back, person } = deskL(sl, a, look));
      else if (sl.kind === "R") ({ back, person } = deskR(sl, a, look));
      else person = beanbagPerson(a, look);
      const away = sl.kind === "B" ? `<g transform="translate(${sl.px.toFixed(1)},${sl.py.toFixed(1)})"><g class="away"><rect x="-26" y="-48" width="52" height="18" rx="5" fill="#0f172a" stroke="#475569"/><text x="0" y="-35" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="10.5" font-weight="700" fill="#94a3b8">AWAY</text></g></g>` : "";
      objects.push({
        d: sl.cx + sl.cy,
        svg: `<g class="scene-agent offline kind-${sl.kind}" id="scene-${esc(a.agent_id)}" data-agent="${esc(a.agent_id)}">${back}<g transform="translate(${sl.px.toFixed(1)},${sl.py.toFixed(1)})">${person}</g>${away}</g>`,
      });
      lights.push(`<g class="desk-light offline" id="light-${esc(a.agent_id)}">${lightFor(sl)}</g>`);
      chipList.push({ a, sl });
    });
    objects.sort((p, q) => p.d - q.d);

    const full = `M0 0 H${VB.w} V${VB.h} H0 Z ${windowHole()}`;
    sceneWrap.querySelector("#sceneSvg").innerHTML = `<svg viewBox="0 0 ${VB.w} ${VB.h}" role="img" aria-label="Kantor virtual isometrik: lima agent di meja dan beanbag, dengan siklus siang ke malam">
      ${defs()}
      <rect x="0" y="0" width="${VB.w}" height="${VB.h}" fill="url(#stage)"/>
      ${shell()}
      <g id="deskLayer">${objects.map((o) => o.svg).join("")}</g>
      <g pointer-events="none">
        <path d="${full}" fill-rule="evenodd" fill="#dbeafe" style="opacity:calc(var(--day) * .08); mix-blend-mode:multiply"/>
        <path d="${full}" fill-rule="evenodd" fill="#ffc27a" style="opacity:calc(var(--gold) * .34); mix-blend-mode:multiply"/>
        <path d="${full}" fill-rule="evenodd" fill="#c47aa0" style="opacity:calc(var(--dusk) * .34); mix-blend-mode:multiply"/>
        <path d="${full}" fill-rule="evenodd" fill="#0c1428" style="opacity:calc(var(--night) * .55)"/>
      </g>
      <g id="lightLayer" pointer-events="none">${lights.join("")}</g>
    </svg>`;

    const chips = sceneWrap.querySelector("#chipLayer");
    chips.innerHTML = "";
    chipList.forEach(({ a, sl }) => {
      const el = document.createElement("button");
      el.type = "button"; el.className = "chip"; el.id = "chip-" + a.agent_id; el.dataset.agent = a.agent_id;
      el.style.left = sl.chip.left + "%"; el.style.top = sl.chip.top + "%";
      el.setAttribute("data-status", "offline");
      el.innerHTML = `<span class="dot"></span><span>${esc(a.name)}</span><span class="st">Offline</span>`;
      chips.appendChild(el);
    });
    sceneWrap.querySelectorAll(".scene-agent").forEach((g) => g.addEventListener("click", () => onSelect(g.dataset.agent)));
    chips.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => onSelect(c.dataset.agent)));
    startCycle(sceneWrap);
  }

  const ST_LABEL = { working: "Bekerja", idle: "Idle", offline: "Offline" };

  function update(a, selected) {
    const g = document.getElementById("scene-" + a.agent_id), c = document.getElementById("chip-" + a.agent_id);
    const l = document.getElementById("light-" + a.agent_id);
    if (g) {
      const kind = (g.getAttribute("class").match(/kind-\w/) || ["kind-L"])[0];
      const cls = `scene-agent ${a.status} ${kind}${selected ? " selected" : ""}`;
      if (g.getAttribute("class") !== cls) g.setAttribute("class", cls);
    }
    if (l) { const lc = "desk-light " + a.status; if (l.getAttribute("class") !== lc) l.setAttribute("class", lc); }
    if (c) {
      c.setAttribute("data-status", a.status);
      c.classList.toggle("selected", !!selected);
      const st = ST_LABEL[a.status] || a.status;
      if (c.querySelector(".st").textContent !== st) c.querySelector(".st").textContent = st;
    }
  }

  function chipPos(agentId) {
    const c = document.getElementById("chip-" + agentId);
    return c ? { left: parseFloat(c.style.left), top: parseFloat(c.style.top) } : { left: 50, top: 50 };
  }

  function setClock(hhmm, dateLine) {
    const wc = document.getElementById("wallClock"), wd = document.getElementById("wallDate");
    if (wc && wc.textContent !== hhmm) wc.textContent = hhmm;
    if (wd && wd.textContent !== dateLine) wd.textContent = dateLine;
  }

  // ------------------------------------------------------------------ day → night cycle
  const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const bell = (a, b, c, d, x) => smooth(a, b, x) * (1 - smooth(c, d, x));

  // 0–.38 pagi · ~.5 golden · .6–.7 senja (lampu menyala) · .74–.9 malam · .9–1 crossfade ke pagi
  function weights(t) {
    const night = bell(0.60, 0.74, 0.90, 1.0, t);
    const gold = bell(0.36, 0.48, 0.52, 0.64, t);
    const dusk = bell(0.50, 0.62, 0.66, 0.78, t) * (1 - night * 0.6);
    const day = Math.max(0, 1 - smooth(0.40, 0.62, t)) + smooth(0.90, 1.0, t);
    const lamp = bell(0.55, 0.66, 0.92, 1.0, t);
    const glow = 0.3 + 0.7 * Math.max(night, lamp * 0.8);
    const wallday = 1 - night * 0.92;
    return { tod: t, day: Math.min(1, day), gold, dusk, night, lamp, glow, wallday };
  }
  function phaseName(w) {
    if (w.tod >= 0.9) return "kembali-pagi";
    if (w.night > 0.6) return "malam";
    if (w.dusk > 0.5 || w.lamp > 0.5) return "senja";
    if (w.gold > 0.5) return "golden";
    return "pagi";
  }

  const cycle = { root: null, raf: 0, last: 0, start: 0, frozen: null, phase: "", listening: false };
  function apply(t) {
    const w = weights(t), s = cycle.root.style;
    for (const k in w) s.setProperty("--" + k, w[k].toFixed(3));
    const p = phaseName(w);
    if (p !== cycle.phase) { cycle.phase = p; cycle.root.dataset.phase = p; }
  }
  function loop(now) {
    cycle.raf = requestAnimationFrame(loop);
    if (now - cycle.last < 50) return; // ~20 updates/s
    cycle.last = now;
    apply(((now - cycle.start) % LOOP_MS) / LOOP_MS);
  }
  function startCycle(root) {
    cycle.root = root;
    const q = new URLSearchParams(location.search).get("tod");
    cycle.frozen = q !== null && q !== "" && isFinite(+q) ? Math.min(1, Math.max(0, +q)) : null; // ?tod=0.8 freezes (debug/screenshots)
    const mq = window.matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : null;
    const decide = () => {
      cancelAnimationFrame(cycle.raf);
      if (cycle.frozen !== null) return apply(cycle.frozen);
      if (mq && mq.matches) return apply(0.2); // reduced motion: stay in daylight
      if (!cycle.start) cycle.start = performance.now();
      cycle.raf = requestAnimationFrame(loop);
    };
    if (mq && !cycle.listening) { cycle.listening = true; mq.addEventListener ? mq.addEventListener("change", decide) : mq.addListener(decide); }
    apply(cycle.frozen ?? 0);
    decide();
  }

  window.OfficeScene = { build, update, chipPos, setClock, esc, weights, LOOP_MS };
})();
