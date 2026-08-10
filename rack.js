/* Rack elevation generator.

   Draws to-scale front and rear rack elevations in the flat, technical style of
   VisioCafe / VSD Grafx stencils: dark charcoal faceplates with drive carriers
   and bezel LEDs on the front, light grey chassis with PSUs, perforated vents
   and port cages on the rear.

   Device colours are fixed rather than themed. A rack elevation is a drawing of
   physical hardware, so it should look identical in light mode, dark mode and
   on paper — only the page chrome around it follows the theme.

   Switch orientation follows Lenovo LP1698, which specifies port-side-exhaust
   switches mounted ports-to-rear so that cabling stays at the back of the rack
   alongside the servers' rear-mounted PCIe adapters. The switch therefore shows
   its PSU/fan side on the front elevation and its port side on the rear, which
   is where the fabric cabling is drawn. */

const G = {
  U: 25,          // pixels per rack unit
  EQ_W: 540,      // equipment face width
  RAIL: 16,       // rack rail width
  TOP: 16,        // frame padding above U1..Umax
  EAR: 14,        // rack ear width on a device face
  CH: 116,        // cable channel width to the right of the rack (rear view)
  LBL: 186,       // left gutter for device labels
};
G.RACK_W = G.EQ_W + G.RAIL * 2;

/* Fixed stencil palette. */
const C = {
  frame: '#3c3c40', frameEdge: '#232326', railFace: '#4a4a4f', railHole: '#1b1b1e',
  uText: '#b9b9be',
  fFace1: '#55555a', fFace2: '#37373b', fEdge: '#1a1a1d',
  bay1: '#76767c', bay2: '#5c5c62', bayEdge: '#2a2a2e', handle: '#8e8e95',
  rFace1: '#e8e8ea', rFace2: '#cfcfd3', rEdge: '#4d4d52',
  psu: '#f2f2f4', psuEdge: '#5a5a60', latch: '#b0316f',
  port: '#17171a', portEdge: '#2f2f34', card: '#f6f6f8',
  ledGreen: '#35c759', ledAmber: '#f0a020', ledBlue: '#3f8ae0',
  rj45: '#2f6f3f', vga: '#2f5fa8', usb: '#2f2f34',
  label: '#e8e8ea', labelDim: '#a9a9b0',
  fabricA: '#2a78d6', fabricB: '#eb6834',
};

const DEFAULT_INPUT = {
  serverKey: 'lenovo-sr630v2', driveKey: 'p5520-7.68', nicKey: 'cx6-hdr200-1p',
  switchKey: 'qm8700', nicCount: 2, cpuId: 'gold-6326', schemeId: '8+2',
  workloadId: 'ai-training', drivesPerNode: 10, ramGB: 256, hotSpares: 1,
  protocols: true, rdma: true, targetTB: 1000, targetReadGBps: 0, manualNodes: null,
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nf = (n, d = 0) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

function loadConfig() {
  try {
    const raw = localStorage.getItem('weka-sizing-config');
    if (raw) return { ...DEFAULT_INPUT, ...JSON.parse(raw) };
  } catch (e) { /* fall through to defaults */ }
  return { ...DEFAULT_INPUT };
}

/* ---------- small drawing helpers ---------- */
const rect = (x, y, w, h, fill, stroke, rx = 0, extra = '') =>
  `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0, w).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="0.7"` : ''}${rx ? ` rx="${rx}"` : ''}${extra ? ' ' + extra : ''}/>`;

const text = (x, y, s, fill, size = 8, anchor = 'start', weight = 400) =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${fill}" font-size="${size}" text-anchor="${anchor}" font-weight="${weight}" font-family="system-ui,-apple-system,sans-serif">${esc(s)}</text>`;

// Gutter width is fixed, so long product names are clipped to fit rather than
// running off the left edge of the drawing.
const clip = (s, n = 30) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

const circle = (cx, cy, r, fill) =>
  `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" fill="${fill}"/>`;

function defs(uid) {
  return `<defs>
    <linearGradient id="fg${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.fFace1}"/><stop offset="0.55" stop-color="${C.fFace2}"/><stop offset="1" stop-color="${C.fFace1}"/>
    </linearGradient>
    <linearGradient id="bg${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.bay1}"/><stop offset="1" stop-color="${C.bay2}"/>
    </linearGradient>
    <linearGradient id="rg${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.rFace1}"/><stop offset="1" stop-color="${C.rFace2}"/>
    </linearGradient>
    <pattern id="perf${uid}" width="4" height="4" patternUnits="userSpaceOnUse">
      <rect width="4" height="4" fill="none"/><rect x="0.8" y="0.8" width="2.1" height="2.1" fill="#9a9aa1" rx="0.4"/>
    </pattern>
    <pattern id="perfd${uid}" width="4" height="4" patternUnits="userSpaceOnUse">
      <rect width="4" height="4" fill="none"/><rect x="0.8" y="0.8" width="2.1" height="2.1" fill="#232326" rx="0.4"/>
    </pattern>
  </defs>`;
}

/* Rack ears with mounting holes, drawn on both sides of a device face. */
function ears(w, h, dark) {
  const face = dark ? C.fFace1 : C.psu;
  const edge = dark ? C.fEdge : C.rEdge;
  const hole = dark ? '#141416' : '#8d8d94';
  let s = rect(0, 0, G.EAR, h, face, edge) + rect(w - G.EAR, 0, G.EAR, h, face, edge);
  const n = Math.max(1, Math.round(h / G.U));
  for (let i = 0; i < n; i++) {
    const cy = (i + 0.5) * (h / n);
    s += circle(G.EAR / 2, cy, 1.5, hole) + circle(w - G.EAR / 2, cy, 1.5, hole);
  }
  return s;
}

/* ---------- front faces ---------- */
function serverFront(w, h, ctx, uid) {
  const { server, drivesPerNode, label } = ctx;
  let s = rect(0, 0, w, h, `url(#fg${uid})`, C.fEdge, 1.5);
  s += ears(w, h, true);

  // Status LED column, as on a real bezel.
  const lx = G.EAR + 7;
  const icons = ['#8e8e95', C.ledGreen, C.ledAmber, '#8e8e95'];
  icons.forEach((col, i) => {
    const cy = 4 + (i + 0.5) * ((h - 8) / icons.length);
    s += circle(lx, cy, 1.5, col);
  });

  // Drive carriers. A 2.5" carrier is about 15 mm across on a 450 mm usable
  // face, so ten of them cover roughly a third of the width — the rest of the
  // bezel is vent. Bays are given that real pitch and only shrink if they
  // would not otherwise fit.
  const x0 = G.EAR + 15, x1 = w - G.EAR - 4;
  const avail = x1 - x0;
  const rows = h >= G.U * 2 - 2 && drivesPerNode > 14 ? 2 : 1;
  const perRow = Math.ceil(drivesPerNode / rows);
  const gap = 1.4;
  const pitch = Math.min(17, avail / perRow);
  const bw = pitch - gap;
  const bh = (h - 7 - gap * (rows - 1)) / rows;

  // Perforated bezel filling the space the carriers do not occupy.
  const bayZone = perRow * pitch;
  if (avail - bayZone > 12) {
    s += rect(x0 + bayZone + 6, 3.5, avail - bayZone - 8, h - 7, `url(#perfd${uid})`, '#2a2a2e', 0.8);
  }

  let drawn = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < perRow && drawn < drivesPerNode; c++, drawn++) {
      const bx = x0 + c * pitch;
      const by = 3.5 + r * (bh + gap);
      s += rect(bx, by, bw, bh, `url(#bg${uid})`, C.bayEdge, 0.8);
      // Carrier handle down the left edge, plus activity LEDs on the right.
      s += rect(bx + 1, by + 1.2, Math.min(2.2, bw * 0.18), bh - 2.4, C.handle, '', 0.6);
      if (bw > 9) {
        s += circle(bx + bw - 2.6, by + 2.6, 0.8, C.ledGreen);
        s += circle(bx + bw - 2.6, by + bh - 2.6, 0.8, '#4a4a50');
      }
    }
  }

  return s;
}

/* Ports face the rear, so the front elevation shows the PSU / fan side. */
function switchFront(w, h, ctx, uid) {
  let s = rect(0, 0, w, h, `url(#fg${uid})`, C.fEdge, 1.5);
  s += ears(w, h, true);
  const x0 = G.EAR + 6, x1 = w - G.EAR - 6;

  // Two PSU modules and a bank of fan modules.
  const pw = 52;
  [0, 1].forEach((i) => {
    const px = x0 + i * (pw + 4);
    s += rect(px, 3, pw, h - 6, '#46464b', C.fEdge, 1);
    s += rect(px + 3, 5.5, pw - 6, h - 11, `url(#perfd${uid})`, '#2c2c30', 0.6);
  });
  const fx0 = x0 + 2 * (pw + 4) + 8;
  const fanW = 26, fanN = Math.max(1, Math.floor((x1 - fx0) / (fanW + 3)));
  for (let i = 0; i < fanN; i++) {
    const fx = fx0 + i * (fanW + 3);
    s += rect(fx, 3, fanW, h - 6, '#46464b', C.fEdge, 1);
    s += circle(fx + fanW / 2, h / 2, Math.min(5.5, h / 2 - 3), '#33333799');
  }
  return s;
}

/* ---------- rear faces ---------- */
function serverRear(w, h, ctx, uid) {
  const { nicCount, nic, showLabels } = ctx;
  let s = rect(0, 0, w, h, `url(#rg${uid})`, C.rEdge, 1.5);
  s += ears(w, h, false);

  // Two PSUs on the left, each with an IEC inlet and a fan grille.
  const px = G.EAR + 4, pw = 62, ph = (h - 7) / 2;
  [0, 1].forEach((i) => {
    const py = 3.5 + i * (ph + 0.6);
    s += rect(px, py, pw, ph, C.psu, C.psuEdge, 1);
    s += rect(px + 2, py + 1.5, 5, 3, C.latch, '', 0.5);
    s += rect(px + 10, py + ph / 2 - 3.2, 11, 6.4, C.port, C.portEdge, 1);
    s += rect(px + 24, py + 1.6, pw - 27, ph - 3.2, `url(#perf${uid})`, '#9a9aa1', 0.6);
  });

  // Perforated exhaust area.
  const vx = px + pw + 5;
  const vw = 96;
  s += rect(vx, 3.5, vw, h - 7, `url(#perf${uid})`, '#9a9aa1', 0.8);

  // Onboard I/O cluster.
  const ix = vx + vw + 5;
  s += rect(ix, h / 2 - 4.6, 9, 7.4, C.rj45, C.portEdge, 0.8);
  s += rect(ix + 11, h / 2 - 4.2, 6, 3, C.usb, C.portEdge, 0.5);
  s += rect(ix + 11, h / 2 + 0.4, 6, 3, C.usb, C.portEdge, 0.5);
  s += rect(ix + 19, h / 2 - 3.4, 11, 5.4, C.vga, C.portEdge, 0.8);

  // PCIe risers carrying the fabric adapters. These are the cable anchors.
  const ports = [];
  const cx0 = ix + 34;
  const cx1 = w - G.EAR - 4;
  const cardW = (cx1 - cx0 - 4 * (nicCount - 1)) / nicCount;
  for (let a = 0; a < nicCount; a++) {
    const ax = cx0 + a * (cardW + 4);
    s += rect(ax, 3.5, cardW, h - 7, C.card, C.psuEdge, 1);
    const n = nic.ports;
    const cageW = Math.min(17, (cardW - 8) / n - 2);
    const totalW = n * cageW + (n - 1) * 2.5;
    const sx = ax + (cardW - totalW) / 2;
    for (let p = 0; p < n; p++) {
      const qx = sx + p * (cageW + 2.5);
      const qy = h / 2 - 4.2;
      s += rect(qx, qy, cageW, 8.4, C.port, C.portEdge, 1);
      s += rect(qx + 1.4, qy + 1.6, cageW - 2.8, 5.2, '#26262b', '', 0.5);
      ports.push({ x: qx + cageW / 2, y: qy + 4.2 });
    }
  }

  return { svg: s, ports };
}

/* Port side of the switch — this is what faces the rear of the rack. */
function switchRear(w, h, ctx, uid) {
  const { sw, showLabels } = ctx;
  let s = rect(0, 0, w, h, `url(#rg${uid})`, C.rEdge, 1.5);
  s += ears(w, h, false);

  const x0 = G.EAR + 5, x1 = w - G.EAR - 30;
  // Management and console ports.
  s += rect(x0, h / 2 - 4.2, 9, 7, C.rj45, C.portEdge, 0.8);
  s += rect(x0 + 11, h / 2 - 3.6, 8, 5.8, '#2f2f34', C.portEdge, 0.8);
  [0, 1, 2].forEach((i) => s += circle(x0 + 23, 5 + i * ((h - 10) / 2), 1.3, i === 0 ? C.ledGreen : '#8d8d94'));

  // QSFP cages in two staggered rows, as on a 1U 32-port leaf.
  const px0 = x0 + 30;
  const avail = x1 - px0;
  const total = sw.ports;
  // A 1U leaf stacks its cages in two rows once past ~16 ports, as on a QM8700.
  const rows = total > 16 ? 2 : 1;
  const perRow = Math.ceil(total / rows);
  const gap = 2;
  const cw = Math.max(6, (avail - gap * (perRow - 1)) / perRow);
  const chh = rows === 2 ? (h - 9) / 2 : h - 8;

  const ports = [];
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < perRow && n < total; c++, n++) {
      const qx = px0 + c * (cw + gap);
      const qy = 4 + r * (chh + 1);
      s += rect(qx, qy, cw, chh, C.port, C.portEdge, 1);
      s += rect(qx + 1, qy + 1.2, cw - 2, chh - 2.4, '#26262b', '', 0.5);
      ports.push({ x: qx + cw / 2, y: qy + chh / 2 });
    }
  }
  // PSU bays at the far right.
  [0, 1].forEach((i) => {
    const py = 3.5 + i * ((h - 7) / 2 + 0.5);
    s += rect(x1 + 4, py, 22, (h - 8) / 2, C.psu, C.psuEdge, 1);
    s += rect(x1 + 6, py + 1, 18, (h - 8) / 2 - 2, `url(#perf${uid})`, '#9a9aa1', 0.5);
  });

  return { svg: s, ports };
}

/* ---------- rack frame ---------- */
function rackFrame(totalU, uid) {
  const H = totalU * G.U + G.TOP * 2;
  let s = rect(0, 0, G.RACK_W, H, C.frame, C.frameEdge, 3);
  s += rect(G.RAIL, G.TOP, G.EQ_W, totalU * G.U, '#1e1e21', '');
  // Rails with per-U mounting holes and numbering.
  for (let u = 1; u <= totalU; u++) {
    const y = G.TOP + (totalU - u) * G.U;
    s += rect(1.5, y, G.RAIL - 3, G.U, C.railFace, '#2b2b2f', 0.5);
    s += rect(G.RACK_W - G.RAIL + 1.5, y, G.RAIL - 3, G.U, C.railFace, '#2b2b2f', 0.5);
    [0.28, 0.72].forEach((f) => {
      s += rect(G.RAIL / 2 - 1, y + G.U * f - 1, 2, 2, C.railHole, '', 0.3);
      s += rect(G.RACK_W - G.RAIL / 2 - 1, y + G.U * f - 1, 2, 2, C.railHole, '', 0.3);
    });
    if (u % 2 === 1 || totalU <= 24) {
      s += text(G.RAIL / 2, y + G.U / 2 + 2.2, String(u), C.uText, 5.5, 'middle');
    }
  }
  return { svg: s, H };
}

/* ---------- layout ---------- */
function buildLayout(r, opts) {
  const totalU = opts.totalU;
  const tor = opts.torCount;
  const serverRU = r.server.ru;
  const swRU = r.sw.ru;
  // Switches at the top, then a 1U gap for cable management, then servers.
  const usable = totalU - tor * swRU - 1;
  const perRack = Math.max(1, Math.floor(usable / serverRU));
  const rackCount = Math.max(1, Math.ceil(r.nodes / perRack));

  const racks = [];
  let placed = 0;
  for (let i = 0; i < rackCount; i++) {
    const devices = [];
    let u = totalU;
    for (let t = 0; t < tor; t++) {
      devices.push({ kind: 'switch', uTop: u, ru: swRU, label: `${r.sw.label} — fabric ${String.fromCharCode(65 + t)}`, fabric: t });
      u -= swRU;
    }
    u -= 1; // cable management gap
    const here = Math.min(perRack, r.nodes - placed);
    for (let n = 0; n < here; n++) {
      placed++;
      devices.push({ kind: 'server', uTop: u, ru: serverRU, label: `${r.server.label} — node ${placed}`, node: placed });
      u -= serverRU;
    }
    racks.push({ name: rackCount > 1 ? `Rack ${i + 1} of ${rackCount}` : 'Rack 1', devices, nodes: here });
  }
  return { racks, perRack };
}

/* ---------- rack rendering ---------- */
function renderRack(rack, side, r, opts, uid) {
  const { svg: frame, H } = rackFrame(opts.totalU, uid);
  const isRear = side === 'rear';
  const gutter = opts.showLabels ? G.LBL : 8;
  const W = gutter + G.RACK_W + (isRear && opts.showCables ? G.CH : 0);

  let body = '';
  let labels = '';
  const switchPorts = {};   // fabric index -> port list in rack coords
  const serverPorts = [];   // { fabric, x, y } per cable

  // Devices are drawn top-down so switches land before the servers that cable to them.
  rack.devices.forEach((d) => {
    const y = G.TOP + (opts.totalU - d.uTop) * G.U;
    const h = d.ru * G.U - 1.2;
    const ctx = {
      server: r.server, sw: r.sw, nic: r.nic, nicCount: r.nicCount || opts.nicCount,
      drivesPerNode: r.drivesPerNode, label: d.label, showLabels: opts.showLabels,
    };
    let inner = '';
    if (d.kind === 'switch') {
      if (isRear) {
        const out = switchRear(G.EQ_W, h, ctx, uid);
        inner = out.svg;
        switchPorts[d.fabric] = out.ports.map((p) => ({ x: p.x + G.RAIL, y: p.y + y }));
      } else inner = switchFront(G.EQ_W, h, ctx, uid);
    } else if (isRear) {
      const out = serverRear(G.EQ_W, h, ctx, uid);
      inner = out.svg;
      out.ports.forEach((p, i) => serverPorts.push({
        fabric: opts.torCount > 1 ? i % opts.torCount : 0,
        x: p.x + G.RAIL, y: p.y + y, node: d.node,
      }));
    } else inner = serverFront(G.EQ_W, h, ctx, uid);

    body += `<g transform="translate(${G.RAIL},${y.toFixed(1)})">${inner}</g>`;

    // Device label in the left gutter, with a leader line to the chassis.
    if (opts.showLabels) {
      const cy = y + (d.ru * G.U) / 2;
      const uSpan = d.ru > 1 ? `U${d.uTop - d.ru + 1}–${d.uTop}` : `U${d.uTop}`;
      // Two lines: a short identifier, then model and U position. Keeps long
      // product names from overrunning the gutter.
      const name = d.kind === 'switch' ? `Fabric ${String.fromCharCode(65 + d.fabric)}` : `Node ${d.node}`;
      const detail = d.kind === 'switch' ? `${r.sw.label.replace(/^NVIDIA /, '')} · ${uSpan}` : `${r.server.label} · ${uSpan}`;
      labels += text(gutter - 24, cy - 0.5, name, 'var(--text-primary)', 9, 'end', 600);
      labels += text(gutter - 24, cy + 8.5, clip(detail), 'var(--text-muted)', 7.2, 'end');
      labels += `<line x1="${gutter - 20}" y1="${cy}" x2="${gutter - 4}" y2="${cy}" stroke="var(--border-strong)" stroke-width="1"/>`;
    }
  });

  // Fabric cabling: each server port curves out into the channel and up to its
  // switch. Drawn under a low opacity so dense bundles stay readable.
  let cables = '';
  if (isRear && opts.showCables) {
    const counters = {};
    serverPorts.forEach((sp) => {
      const list = switchPorts[sp.fabric];
      if (!list || !list.length) return;
      const idx = counters[sp.fabric] = (counters[sp.fabric] || 0);
      counters[sp.fabric]++;
      const target = list[idx % list.length];
      const col = sp.fabric === 0 ? C.fabricA : C.fabricB;
      const lane = G.RACK_W + 14 + (sp.fabric * 16) + (idx % 5) * 2.4;
      const d = `M${sp.x.toFixed(1)},${sp.y.toFixed(1)} C${(G.RACK_W - 4).toFixed(1)},${sp.y.toFixed(1)} ${lane.toFixed(1)},${sp.y.toFixed(1)} ${lane.toFixed(1)},${((sp.y + target.y) / 2).toFixed(1)} C${lane.toFixed(1)},${target.y.toFixed(1)} ${(G.RACK_W - 4).toFixed(1)},${target.y.toFixed(1)} ${target.x.toFixed(1)},${target.y.toFixed(1)}`;
      cables += `<path d="${d}" fill="none" stroke="${col}" stroke-width="1.3" opacity="0.62" stroke-linecap="round"/>`;
    });
  }

  // Labels sit in page coordinates; the rack itself is shifted right by the gutter.
  return `<svg class="rack-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"
      aria-label="${esc(side)} rack elevation">${defs(uid)}${labels}<g transform="translate(${gutter},0)">${frame}${body}${cables}</g></svg>`;
}

/* ---------- page ---------- */
let LAST_SVG = '';

function render() {
  const input = loadConfig();
  const r = size(input);
  r.nicCount = input.nicCount;

  const opts = {
    totalU: +document.getElementById('rackU').value,
    torCount: +document.getElementById('torCount').value,
    showCables: document.getElementById('showCables').checked,
    showLabels: document.getElementById('showLabels').checked,
    nicCount: input.nicCount,
    view: document.getElementById('view').value,
  };

  const layout = buildLayout(r, opts);
  const portsPerNode = r.nic.ports * input.nicCount;

  document.getElementById('ctl-summary').innerHTML =
    `<b>${r.nodes}</b> × ${esc(r.server.label)} · <b>${layout.racks.length}</b> rack${layout.racks.length > 1 ? 's' : ''} ·
     <b>${r.nodes * portsPerNode}</b> fabric ports · ${esc(r.sw.label)}<br>
     ${esc(r.drive.label)} × ${r.drivesPerNode} per node · ${esc(r.scheme.id)} · ${nf(r.capacity.netTB, 0)} TB usable`;

  const sections = [];
  let uid = 0;

  const mk = (side, title, sub) => {
    const racks = layout.racks.map((rk) => `
      <div class="rack-unit">
        <div class="rack-name">${esc(rk.name)}</div>
        ${renderRack(rk, side, r, opts, `${side}${uid++}`)}
      </div>`).join('');
    return `<section class="rack-section">
      <h2>${esc(title)}</h2>
      <p class="sub">${sub}</p>
      <div class="rack-row">${racks}</div>
    </section>`;
  };

  if (opts.view !== 'rear') {
    sections.push(mk('front', 'Front elevation',
      `${r.drivesPerNode} NVMe carriers per node. The switches show their PSU and fan side here — with port-side-exhaust switches mounted ports-to-rear, all cabling stays at the back of the rack.`));
  }

  if (opts.view !== 'front') {
    const cableNote = opts.showCables
      ? `Each node's ${portsPerNode} fabric port${portsPerNode > 1 ? 's are' : ' is'} split across the ${opts.torCount === 2 ? 'redundant switch pair' : 'top-of-rack switch'}, so a switch or adapter failure leaves the node reachable.`
      : 'Cabling hidden.';
    sections.push(mk('rear', 'Rear elevation and storage fabric',
      `PSUs, perforated exhaust and the PCIe-mounted fabric adapters. ${cableNote}`));
  }

  const legend = opts.view !== 'front' && opts.showCables ? `
    <div class="rack-legend">
      <div class="legend-item"><span class="line" style="background:${C.fabricA}"></span>Fabric A — ${esc(r.sw.label)}</div>
      ${opts.torCount > 1 ? `<div class="legend-item"><span class="line" style="background:${C.fabricB}"></span>Fabric B — ${esc(r.sw.label)}</div>` : ''}
      <div class="legend-item"><span class="line" style="background:${C.rj45}"></span>1 GbE out-of-band management (not drawn)</div>
    </div>` : '';

  document.getElementById('rack-main').innerHTML = sections.join('') + legend + `
    <p class="rack-note">
      Elevations are to scale at ${G.U} px per rack unit, ${opts.totalU}U frames, with ${layout.perRack} node${layout.perRack > 1 ? 's' : ''} plus ${opts.torCount} switch${opts.torCount > 1 ? 'es' : ''} and a 1U cable-management gap per rack.
      This is a planning sketch, not a wiring schedule: port-level assignment, cable lengths, breakout cabling, PDU placement and out-of-band management are all left to detailed design.
      Switch orientation follows Lenovo LP1698, which specifies port-side-exhaust switches mounted ports-to-rear.
    </p>`;

  LAST_SVG = document.querySelector('.rack-svg')?.outerHTML || '';
}

function exportSVG() {
  const svgs = [...document.querySelectorAll('.rack-svg')];
  if (!svgs.length) return;
  const parts = svgs.map((s) => s.outerHTML);
  const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n` +
    parts.map((p) => p.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')).join('\n')],
    { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'weka-rack-elevation.svg';
  a.click();
  URL.revokeObjectURL(url);
}

['view', 'rackU', 'torCount'].forEach((id) => document.getElementById(id).addEventListener('change', render));
['showCables', 'showLabels'].forEach((id) => document.getElementById(id).addEventListener('change', render));
document.getElementById('btn-print').addEventListener('click', () => window.print());
document.getElementById('btn-svg').addEventListener('click', exportSVG);
document.getElementById('btn-theme').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : cur === 'light' ? 'dark'
    : (matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark');
  document.documentElement.setAttribute('data-theme', next);
});
// Reflect edits made in the sizing tab without a reload.
window.addEventListener('storage', (e) => { if (e.key === 'weka-sizing-config') render(); });

render();
