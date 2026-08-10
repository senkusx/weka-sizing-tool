/* Reference-architecture rack elevations.

   Draws the full solution — management, GPU compute, switch fabric and storage
   racks — in the same flat VisioCafe / VSD Grafx stencil idiom as rack.js, but
   for InferX equipment. Self-contained under window.RARack so it can share a
   page with the storage renderer without colliding on globals.

   Faceplates are drawn to the real unit: a DGX B300 is 10U with its PSU bank
   above the GPU tray, a Supermicro 8U HGX chassis carries a front GPU tray over
   an NVMe bank, and a WEKApod Nitro is a 2U four-node chassis rather than four
   separate 1U boxes. */
window.RARack = (function () {
  'use strict';

  const G = { U: 22, EQ_W: 500, RAIL: 15, TOP: 15, EAR: 13, LBL: 176 };
  G.RACK_W = G.EQ_W + G.RAIL * 2;

  const C = {
    frame: '#3c3c40', frameEdge: '#232326', railFace: '#4a4a4f', railHole: '#1b1b1e', uText: '#b9b9be',
    f1: '#55555a', f2: '#37373b', fEdge: '#1a1a1d',
    bay1: '#76767c', bay2: '#5c5c62', bayEdge: '#2a2a2e', handle: '#8e8e95',
    r1: '#e8e8ea', r2: '#cfcfd3', rEdge: '#4d4d52',
    psu: '#f2f2f4', psuEdge: '#5a5a60', latch: '#b0316f',
    port: '#17171a', portEdge: '#2f2f34', card: '#f6f6f8',
    green: '#35c759', amber: '#f0a020', nv: '#76b900',
    // DGX livery from RA-11337-001 Fig 2.1: a large brushed gold panel with a
    // lighter bezel, on a black chassis.
    dgxGold: '#a98f5c', dgxGoldLo: '#8d7647', dgxBezel: '#c9b482',
    // NVIDIA Spectrum switches ship in a tan/khaki chassis (Fig 4.6, Fig 4.10).
    nvTan: '#c3b795', nvTanLo: '#a89c7c', nvTanEdge: '#6d6448',
    blank: '#33333a', blankEdge: '#26262b',
  };

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rect = (x, y, w, h, fill, stroke, rx = 0) =>
    `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0, w).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="0.7"` : ''}${rx ? ` rx="${rx}"` : ''}/>`;
  const text = (x, y, s, fill, size = 8, anchor = 'start', weight = 400) =>
    `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${fill}" font-size="${size}" text-anchor="${anchor}" font-weight="${weight}" font-family="system-ui,-apple-system,sans-serif">${esc(s)}</text>`;
  const circ = (cx, cy, r, fill) => `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" fill="${fill}"/>`;
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

  function defs(uid) {
    return `<defs>
      <linearGradient id="fg${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${C.f1}"/><stop offset="0.55" stop-color="${C.f2}"/><stop offset="1" stop-color="${C.f1}"/></linearGradient>
      <linearGradient id="bg${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${C.bay1}"/><stop offset="1" stop-color="${C.bay2}"/></linearGradient>
      <linearGradient id="rg${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${C.r1}"/><stop offset="1" stop-color="${C.r2}"/></linearGradient>
      <pattern id="pf${uid}" width="4" height="4" patternUnits="userSpaceOnUse">
        <rect x="0.8" y="0.8" width="2.1" height="2.1" fill="#9a9aa1" rx="0.4"/></pattern>
      <pattern id="pd${uid}" width="4" height="4" patternUnits="userSpaceOnUse">
        <rect x="0.8" y="0.8" width="2.1" height="2.1" fill="#232326" rx="0.4"/></pattern>
      <linearGradient id="gold${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${C.dgxBezel}"/><stop offset="0.45" stop-color="${C.dgxGold}"/><stop offset="1" stop-color="${C.dgxGoldLo}"/></linearGradient>
      <linearGradient id="tan${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${C.nvTan}"/><stop offset="1" stop-color="${C.nvTanLo}"/></linearGradient>
      <pattern id="hc${uid}" width="7" height="6" patternUnits="userSpaceOnUse">
        <path d="M3.5 0 L7 1.7 L7 4.3 L3.5 6 L0 4.3 L0 1.7 Z" fill="none" stroke="#2a2a2e" stroke-width="0.6"/></pattern>
    </defs>`;
  }

  function ears(w, h, dark) {
    const face = dark ? C.f1 : C.psu, edge = dark ? C.fEdge : C.rEdge, hole = dark ? '#141416' : '#8d8d94';
    let s = rect(0, 0, G.EAR, h, face, edge) + rect(w - G.EAR, 0, G.EAR, h, face, edge);
    const n = Math.max(1, Math.round(h / G.U));
    for (let i = 0; i < n; i++) {
      const cy = (i + 0.5) * (h / n);
      s += circ(G.EAR / 2, cy, 1.5, hole) + circ(w - G.EAR / 2, cy, 1.5, hole);
    }
    return s;
  }

  /* Row of NVMe carriers, drawn at realistic 2.5" pitch. */
  function driveRow(x, y, w, h, n, uid) {
    const pitch = Math.min(15, w / n), bw = pitch - 1.3;
    let s = '';
    for (let i = 0; i < n; i++) {
      const bx = x + i * pitch;
      s += rect(bx, y, bw, h, `url(#bg${uid})`, C.bayEdge, 0.7);
      s += rect(bx + 0.9, y + 1, Math.min(2, bw * 0.18), h - 2, C.handle, '', 0.5);
      if (bw > 8) s += circ(bx + bw - 2.3, y + 2.4, 0.75, C.green);
    }
    return s;
  }

  /* ---------- GPU compute nodes ---------- */
  /* Supermicro HGX chassis: GPU tray occupies the upper two thirds of the face
     behind a honeycomb intake, with the NVMe bank and I/O below. */
  function hgxFront(w, h, d, uid) {
    let s = rect(0, 0, w, h, `url(#fg${uid})`, C.fEdge, 2) + ears(w, h, true);
    const x0 = G.EAR + 6, x1 = w - G.EAR - 6, iw = x1 - x0;
    const trayH = h * 0.62;
    // GPU tray intake.
    s += rect(x0, 4, iw, trayH - 6, '#3e3e44', C.fEdge, 1.5);
    s += rect(x0 + 3, 6.5, iw - 6, trayH - 11, `url(#hc${uid})`, '#33333a', 1);
    s += text(x0 + 10, 4 + (trayH - 6) / 2 + 3, `${d.gpuCount}x ${d.gpuShort}`, '#8f8f97', 8.5, 'start', 600);
    // Status cluster, then the E1.S bank. Supermicro's HGX chassis carries eight
    // hot-swap E1.S carriers plus two M.2 boot devices — E1.S is a narrow blade,
    // not the wide U.2 carrier this used to draw.
    const by = trayH + 3, bh = h - trayH - 8;
    [C.green, C.amber, '#8e8e95'].forEach((c, i) => s += circ(x0 + 5, by + 4 + i * ((bh - 8) / 2 || 1), 1.5, c));
    const bays = 8, pitch = 9;
    for (let i = 0; i < bays; i++) {
      const bx = x0 + 12 + i * pitch;
      s += rect(bx, by, pitch - 1.6, bh, `url(#bg${uid})`, C.bayEdge, 0.6);
      s += rect(bx + 0.8, by + 1.2, 1.6, bh - 2.4, C.handle, '', 0.4);
      s += circ(bx + pitch - 3.6, by + 2.4, 0.7, C.green);
    }
    const vx = x0 + 12 + bays * pitch + 6;
    s += rect(vx, by, x1 - vx, bh, `url(#pd${uid})`, '#2a2a2e', 0.8);
    s += text(x1 - 3, by + bh - 2, '8x E1.S', '#6d6d75', 6, 'end', 500);
    return s;
  }

  /* DGX B300 front, per RA-11337-001 Figure 2.1: a black chassis dominated by a
     single large brushed-gold intake panel with a lighter bezel and the NVIDIA
     wordmark low and centred, over a dark I/O band of module slots. Earlier
     versions of this drawing used narrow bronze fins, which is the GB200 rack
     look rather than the DGX B300 appliance. */
  function dgxFront(w, h, d, uid) {
    let s = rect(0, 0, w, h, '#1b1b1e', '#0c0c0e', 2);
    // Black rack ears with corner fasteners, as in the figure.
    s += rect(0, 0, G.EAR, h, '#232326', '#0c0c0e') + rect(w - G.EAR, 0, G.EAR, h, '#232326', '#0c0c0e');
    [4, h - 4].forEach((cy) => {
      s += circ(G.EAR / 2, cy, 1.6, '#3a3a40') + circ(w - G.EAR / 2, cy, 1.6, '#3a3a40');
    });

    const x0 = G.EAR + 7, x1 = w - G.EAR - 7, iw = x1 - x0;
    // The gold panel takes the upper three quarters of the face.
    const gy = 4, gh = h * 0.72;
    s += rect(x0, gy, iw, gh, C.dgxBezel, '#6f5f38', 3);              // bezel
    s += rect(x0 + 2.5, gy + 2.5, iw - 5, gh - 5, `url(#gold${uid})`, '#7a6740', 2);
    // Brushed texture: fine vertical striations across the panel.
    for (let i = 0; i < 60; i++) {
      const fx = x0 + 4 + i * ((iw - 8) / 60);
      s += `<line x1="${fx.toFixed(1)}" y1="${(gy + 4).toFixed(1)}" x2="${fx.toFixed(1)}" y2="${(gy + gh - 4).toFixed(1)}" stroke="#00000018" stroke-width="0.7"/>`;
    }
    // NVIDIA eye and wordmark, low centre.
    const ly0 = gy + gh - 9, cx = x0 + iw / 2;
    s += `<ellipse cx="${(cx - 17).toFixed(1)}" cy="${ly0.toFixed(1)}" rx="4.5" ry="3" fill="none" stroke="#4a3f22" stroke-width="1.1"/>`;
    s += circ(cx - 17, ly0, 1.2, '#4a3f22');
    s += text(cx + 3, ly0 + 2.6, 'NVIDIA', '#4a3f22', 7.5, 'middle', 700);

    // Dark I/O band beneath: module slots with status LEDs.
    const by = gy + gh + 3, bh = h - by - 4;
    s += rect(x0, by, iw, bh, '#131315', '#08080a', 1.5);
    s += circ(x0 + 5, by + bh / 2, 1.4, C.green);
    const slots = 10, sp = (iw - 26) / slots;
    for (let i = 0; i < slots; i++) {
      s += rect(x0 + 11 + i * sp, by + 1.8, sp - 1.6, bh - 3.6, '#2b2b30', '#101012', 0.5);
    }
    s += rect(x1 - 12, by + 1.8, 10, bh - 3.6, '#2b2b30', '#101012', 0.5);
    return s;
  }

  /* DGX B300 rear, per Figure 4.1: four compute OSFP at each top corner, a
     mirrored pair of in-band management and storage QSFP clusters, BMC and LAN
     RJ45, and module bays across the centre. */
  function dgxRear(w, h, d, uid) {
    let s = rect(0, 0, w, h, '#17171a', '#08080a', 2);
    s += rect(0, 0, G.EAR, h, '#232326', '#0c0c0e') + rect(w - G.EAR, 0, G.EAR, h, '#232326', '#0c0c0e');
    const x0 = G.EAR + 6, x1 = w - G.EAR - 6, iw = x1 - x0;
    const anchors = [];

    // Compute fabric: 4x OSFP at each top corner.
    const cageW = 15, gap = 2.5, groupW = 4 * cageW + 3 * gap;
    [x0 + 2, x1 - groupW - 2].forEach((gx) => {
      s += rect(gx - 2, 2.5, groupW + 4, 12, '#0f0f11', '#2e6b2e', 1);
      for (let i = 0; i < 4; i++) {
        const qx = gx + i * (cageW + gap);
        s += rect(qx, 4, cageW, 9, C.port, '#3a3a40', 1);
        s += rect(qx + 1.3, 5.6, cageW - 2.6, 5.8, '#26262b', '', 0.5);
        anchors.push({ x: qx + cageW / 2, y: 8.5, fabric: 'ew' });
      }
    });

    // Two mirrored I/O clusters: in-band management QSFP + storage QSFP.
    const iy = h * 0.52;
    [x0 + 4, x1 - 92].forEach((ix, side) => {
      s += rect(ix, iy - 4, 9, 7.5, '#2f6f3f', '#3a3a40', 0.8);            // RJ45
      for (let q = 0; q < 2; q++) {
        const qx = ix + 13 + q * 17;
        s += rect(qx, iy - 4.5, 15, 8.5, C.port, '#3a3a40', 1);
        s += rect(qx + 1.3, iy - 3, 12.4, 5.5, '#26262b', '', 0.5);
        anchors.push({ x: qx + 7.5, y: iy, fabric: 'ns' });
      }
      if (side === 1) {
        s += rect(ix + 48, iy - 4, 9, 7.5, '#2f6f3f', '#3a3a40', 0.8);      // BMC
        anchors.push({ x: ix + 52.5, y: iy, fabric: 'oob' });
        s += rect(ix + 60, iy - 4, 9, 7.5, '#2f6f3f', '#3a3a40', 0.8);      // LAN
      }
    });

    // Module bays across the centre.
    const mx = x0 + 100, mw = x1 - 100 - mx;
    if (mw > 40) {
      s += rect(mx, iy - 7, mw, 15, '#101012', '#2a2a2e', 1);
      const n = 6, sp = (mw - 4) / n;
      for (let i = 0; i < n; i++) s += rect(mx + 2 + i * sp, iy - 5, sp - 2, 11, '#2b2b30', '#101012', 0.5);
    }
    s += text(x0 + 4, h - 3, 'DGX B300', '#6d6d75', 6.5, 'start', 600);
    return { svg: s, anchors };
  }

  /* DGX power shelf, per Figure 2.2: six 5.5 kW supplies (33 kW) with a power
     management board carrying the BMC port at the far left. */
  function powerShelf(w, h, d, uid) {
    let s = rect(0, 0, w, h, '#1b1b1e', '#0c0c0e', 1.5);
    s += rect(0, 0, G.EAR, h, '#232326', '#0c0c0e') + rect(w - G.EAR, 0, G.EAR, h, '#232326', '#0c0c0e');
    const x0 = G.EAR + 5, x1 = w - G.EAR - 5;
    // Power management board with BMC RJ45.
    s += rect(x0, 3, 26, h - 6, '#2b2b30', '#101012', 1);
    s += rect(x0 + 4, h / 2 - 4, 10, 8, '#f2f2f4', '#3a3a40', 0.8);
    s += circ(x0 + 20, h / 2 - 2, 1.2, C.green);
    s += circ(x0 + 20, h / 2 + 2, 1.2, '#c03a3a');
    // Six PSU modules.
    const px0 = x0 + 30, pw = (x1 - px0) / 6;
    for (let i = 0; i < 6; i++) {
      const px = px0 + i * pw;
      s += rect(px, 3, pw - 2, h - 6, '#232326', '#0e0e10', 1);
      s += circ(px + 3.5, 6, 1.1, C.green);
      s += rect(px + 6, 5, pw - 11, h - 10, `url(#pd${uid})`, '#141416', 0.5);
      s += rect(px + pw - 5.5, 5, 2.6, h - 10, '#3a3a40', '', 0.5);   // handle
    }
    return s;
  }

  function gpuRear(w, h, d, uid) {
    let s = rect(0, 0, w, h, `url(#rg${uid})`, C.rEdge, 2) + ears(w, h, false);
    const x0 = G.EAR + 4, x1 = w - G.EAR - 4, iw = x1 - x0;
    // PSU column on the left.
    const pn = d.psuCount || 6, pw = 58, ph = (h - 8) / Math.ceil(pn / 2);
    for (let i = 0; i < pn; i++) {
      const col = i % 2, row = Math.floor(i / 2);
      const px = x0 + col * (pw + 3), py = 4 + row * ph;
      s += rect(px, py, pw, ph - 1.5, C.psu, C.psuEdge, 1);
      s += rect(px + 2, py + 1.5, 4, 2.5, C.latch, '', 0.4);
      s += rect(px + 9, py + (ph - 1.5) / 2 - 3, 10, 6, C.port, C.portEdge, 1);
      s += rect(px + 22, py + 1.5, pw - 25, ph - 4.5, `url(#pf${uid})`, '#9a9aa1', 0.5);
    }
    // East-west OSFP cages.
    const cx0 = x0 + 2 * (pw + 3) + 8;
    const n = d.ewPorts || 8, cw = Math.min(20, (x1 - cx0 - 60) / n - 3);
    const anchors = [];
    for (let i = 0; i < n; i++) {
      const qx = cx0 + i * (cw + 3), qy = h * 0.28;
      s += rect(qx, qy, cw, 9, C.port, C.portEdge, 1);
      s += rect(qx + 1.4, qy + 1.7, cw - 2.8, 5.6, '#26262b', '', 0.5);
      anchors.push({ x: qx + cw / 2, y: qy + 4.5, fabric: 'ew' });
    }
    s += text(cx0, h * 0.28 - 3, `${n}x ${d.ewGb || 800}G east-west`, '#5a5a60', 6, 'start', 500);
    // North-south and management.
    const ny = h * 0.62;
    for (let i = 0; i < (d.nsPorts || 2); i++) {
      const qx = cx0 + i * 23;
      s += rect(qx, ny, 20, 9, C.port, C.portEdge, 1);
      s += rect(qx + 1.4, ny + 1.7, 17, 5.6, '#26262b', '', 0.5);
      anchors.push({ x: qx + 10, y: ny + 4.5, fabric: 'ns' });
    }
    s += text(cx0, ny - 3, `${d.nsPorts || 2}x ${d.nsGb || 400}G north-south`, '#5a5a60', 6, 'start', 500);
    s += rect(cx0, h - 14, 9, 7, '#2f6f3f', C.portEdge, 0.8);
    anchors.push({ x: cx0 + 4.5, y: h - 10.5, fabric: 'oob' });
    s += text(cx0 + 12, h - 8, 'BMC / OOB', '#5a5a60', 6, 'start');
    return { svg: s, anchors };
  }

  /* ---------- storage, fabric, platform ---------- */
  /* WEKApod: a 1U server (Nitro, Prime 2118) or 2U (Prime 2218), in WEKA's
     purple livery, with its E3.S / U.2 carriers across the face. */
  function wekapodFront(w, h, d, uid) {
    let s = rect(0, 0, w, h, '#4b2a70', '#2a1740', 2);
    // Rack ears in the same purple rather than the generic grey.
    s += rect(0, 0, G.EAR, h, '#5a3583', '#2a1740') + rect(w - G.EAR, 0, G.EAR, h, '#5a3583', '#2a1740');
    const n = Math.max(1, Math.round(h / G.U));
    for (let i = 0; i < n; i++) {
      const cy = (i + 0.5) * (h / n);
      s += circ(G.EAR / 2, cy, 1.5, '#2a1740') + circ(w - G.EAR / 2, cy, 1.5, '#2a1740');
    }
    const x0 = G.EAR + 6, x1 = w - G.EAR - 6, iw = x1 - x0;
    s += circ(x0 + 4, h / 2, 1.5, C.green);
    // E3.S carriers are narrow and vertical; 14 of them span about half the face.
    const drives = d.drives || 14;
    const zone = Math.min(iw * 0.62, drives * 11);
    const pitch = zone / drives;
    for (let i = 0; i < drives; i++) {
      const bx = x0 + 10 + i * pitch;
      s += rect(bx, 3.5, pitch - 1.4, h - 7, '#6d4a94', '#311c49', 0.6);
      s += rect(bx + 0.7, 5, Math.max(0.8, (pitch - 1.4) * 0.22), h - 10, '#8a68b0', '', 0.4);
    }
    // Perforated intake for the rest of the face, then the WEKA wordmark.
    const vx = x0 + 12 + zone;
    if (x1 - vx > 20) {
      s += rect(vx, 3.5, x1 - vx - 26, h - 7, `url(#pd${uid})`, '#311c49', 0.8);
      s += text(x1 - 3, h / 2 + 3, 'WEKA', '#e6dcf5', Math.min(9, h * 0.36), 'end', 700);
    }
    return s;
  }

  function switchFace(w, h, d, uid, rear) {
    if (!rear) {
      // Port-side-exhaust switches face their ports to the rear. NVIDIA Spectrum
      // switches ship in a tan chassis (RA Fig 4.6, Fig 4.10).
      let s = rect(0, 0, w, h, `url(#tan${uid})`, C.nvTanEdge, 2) + ears(w, h, true);
      const x0 = G.EAR + 6, x1 = w - G.EAR - 6;
      for (let i = 0; i < 2; i++) s += rect(x0 + i * 54, 3, 50, h - 6, '#46464b', C.fEdge, 1) +
        rect(x0 + i * 54 + 3, 5, 44, h - 10, `url(#pd${uid})`, '', 0.6);
      const fx = x0 + 116;
      for (let i = 0; fx + i * 28 < x1 - 24; i++) {
        s += rect(fx + i * 28, 3, 25, h - 6, '#46464b', C.fEdge, 1);
        s += circ(fx + i * 28 + 12.5, h / 2, Math.min(6, h / 2 - 3), '#33333799');
      }
      return { svg: s, anchors: [] };
    }
    let s = rect(0, 0, w, h, `url(#tan${uid})`, C.nvTanEdge, 2);
    s += rect(0, 0, G.EAR, h, C.nvTan, C.nvTanEdge) + rect(w - G.EAR, 0, G.EAR, h, C.nvTan, C.nvTanEdge);
    const x0 = G.EAR + 5, x1 = w - G.EAR - 28;
    s += rect(x0, h / 2 - 4, 9, 7, '#2f6f3f', C.portEdge, 0.8);
    const px0 = x0 + 14, total = d.ports || 64;
    const rows = total > 16 ? 2 : 1, per = Math.ceil(total / rows);
    const cw = Math.max(4, (x1 - px0 - per * 1.6) / per), chh = rows === 2 ? (h - 9) / 2 : h - 8;
    const anchors = [];
    let k = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < per && k < total; c++, k++) {
        const qx = px0 + c * (cw + 1.6), qy = 4 + r * (chh + 1);
        s += rect(qx, qy, cw, chh, C.port, C.portEdge, 0.8);
        anchors.push({ x: qx + cw / 2, y: qy + chh / 2 });
      }
    }
    for (let i = 0; i < 2; i++) s += rect(x1 + 4, 4 + i * ((h - 8) / 2 + 0.5), 20, (h - 9) / 2, C.nvTan, C.nvTanEdge, 1);
    return { svg: s, anchors };
  }

  function genericFace(w, h, d, uid, rear) {
    if (rear) {
      let s = rect(0, 0, w, h, `url(#rg${uid})`, C.rEdge, 2) + ears(w, h, false);
      s += rect(G.EAR + 4, 3, 58, h - 6, C.psu, C.psuEdge, 1);
      s += rect(G.EAR + 66, 3, w - G.EAR * 2 - 70, h - 6, `url(#pf${uid})`, '#9a9aa1', 0.8);
      return { svg: s, anchors: [] };
    }
    let s = rect(0, 0, w, h, `url(#fg${uid})`, C.fEdge, 2) + ears(w, h, true);
    const x0 = G.EAR + 6, x1 = w - G.EAR - 6, iw = x1 - x0;
    s += circ(x0 + 4, h / 2, 1.4, C.green);

    // A 4U 36-bay storage chassis is a grid of 3.5" carriers filling the face.
    if (d.face === 'lff') {
      const cols = 12, rows = 3, gx = x0 + 9;
      const cw = (x1 - gx) / cols, ch = (h - 7) / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const bx = gx + c * cw, by = 3.5 + r * ch;
          s += rect(bx, by, cw - 1.4, ch - 1.4, `url(#bg${uid})`, C.bayEdge, 0.6);
          s += rect(bx + 1, by + 1, 2, ch - 3.4, C.handle, '', 0.4);
          s += circ(bx + cw - 4, by + 2.6, 0.7, C.green);
        }
      }
      return { svg: s, anchors: [] };
    }

    // Network appliances lead with port banks rather than drive bays — the
    // SRX1500 carries twelve 1GbE RJ45 plus four SFP and four SFP+.
    if (d.face === 'ports') {
      const n = d.rj45 || 12, per = Math.ceil(n / 2), pw = 7.5;
      const rowH = (h - 8) / 2;
      for (let i = 0; i < n; i++) {
        s += rect(x0 + 10 + (i % per) * pw, 3.5 + Math.floor(i / per) * (rowH + 1),
          pw - 1.2, rowH, '#2f6f3f', C.fEdge, 0.5);
      }
      const sx = x0 + 12 + per * pw + 6;
      for (let i = 0; i < (d.sfp || 8); i++) {
        const cx = sx + (i % 4) * 13;
        if (cx + 12 > x1) break;
        s += rect(cx, 3.5 + Math.floor(i / 4) * (rowH + 1), 11.5, rowH, C.port, C.portEdge, 0.6);
      }
      return { svg: s, anchors: [] };
    }

    // Default 1U/2U server: hot-swap SFF bank, then vent.
    const n = d.drives || 0;
    if (n) {
      const pitch = Math.min(13, (iw * 0.55) / n);
      for (let i = 0; i < n; i++) {
        const bx = x0 + 10 + i * pitch;
        s += rect(bx, 3, pitch - 1.4, h - 6, `url(#bg${uid})`, C.bayEdge, 0.6);
        s += rect(bx + 0.8, 4.2, 1.8, h - 8.4, C.handle, '', 0.4);
      }
      const vx = x0 + 12 + n * pitch;
      if (x1 - vx > 14) s += rect(vx, 3, x1 - vx, h - 6, `url(#pd${uid})`, '#2a2a2e', 0.8);
    } else {
      s += rect(x0 + 10, 3, iw - 10, h - 6, `url(#pd${uid})`, '#2a2a2e', 0.8);
    }
    return { svg: s, anchors: [] };
  }

  function blank(w, h) {
    return rect(0, 0, w, h, C.blank, C.blankEdge, 1);
  }

  /* ---------- frame ---------- */
  function frame(totalU, uid) {
    const H = totalU * G.U + G.TOP * 2;
    let s = rect(0, 0, G.RACK_W, H, C.frame, C.frameEdge, 3);
    s += rect(G.RAIL, G.TOP, G.EQ_W, totalU * G.U, '#1e1e21', '');
    for (let u = 1; u <= totalU; u++) {
      const y = G.TOP + (totalU - u) * G.U;
      s += rect(1.5, y, G.RAIL - 3, G.U, C.railFace, '#2b2b2f', 0.5);
      s += rect(G.RACK_W - G.RAIL + 1.5, y, G.RAIL - 3, G.U, C.railFace, '#2b2b2f', 0.5);
      [0.28, 0.72].forEach((f) => {
        s += rect(G.RAIL / 2 - 1, y + G.U * f - 1, 2, 2, C.railHole, '', 0.3);
        s += rect(G.RACK_W - G.RAIL / 2 - 1, y + G.U * f - 1, 2, 2, C.railHole, '', 0.3);
      });
      if (u % 2 === 1) s += text(G.RAIL / 2, y + G.U / 2 + 2.2, String(u), C.uText, 5.5, 'middle');
    }
    return { svg: s, H };
  }

  /* ---------- rack rendering ---------- */
  function renderRack(rack, side, opts, uid) {
    const totalU = opts.totalU;
    const { svg: fr, H } = frame(totalU, uid);
    const isRear = side === 'rear';
    const gutter = opts.showLabels ? G.LBL : 8;
    const chW = isRear && opts.showCables ? 108 : 0;
    const W = gutter + G.RACK_W + chW;

    let body = '', labels = '', cables = '';
    const switchAnchors = { ew: [], ns: [], oob: [] };
    const nodeAnchors = [];

    // Fill unoccupied units with blanking panels, exactly as the elevations do.
    const occupied = new Set();
    rack.devices.forEach((d) => { for (let i = 0; i < d.ru; i++) occupied.add(d.uTop - i); });
    if (opts.showBlanks) {
      for (let u = 1; u <= totalU; u++) {
        if (occupied.has(u)) continue;
        const y = G.TOP + (totalU - u) * G.U;
        body += `<g transform="translate(${G.RAIL},${y.toFixed(1)})">${blank(G.EQ_W, G.U - 1.2)}</g>`;
      }
    }

    rack.devices.forEach((d) => {
      const y = G.TOP + (totalU - d.uTop) * G.U;
      const h = d.ru * G.U - 1.2;
      let inner = '', out = null;
      if (d.type === 'dgx') inner = isRear ? (out = dgxRear(G.EQ_W, h, d, uid)).svg : dgxFront(G.EQ_W, h, d, uid);
      else if (d.type === 'powershelf') inner = powerShelf(G.EQ_W, h, d, uid);
      else if (d.type === 'gpu') inner = isRear ? (out = gpuRear(G.EQ_W, h, d, uid)).svg : hgxFront(G.EQ_W, h, d, uid);
      else if (d.type === 'wekapod') inner = isRear ? (out = genericFace(G.EQ_W, h, d, uid, true)).svg : wekapodFront(G.EQ_W, h, d, uid);
      else if (d.type === 'switch') { out = switchFace(G.EQ_W, h, d, uid, isRear); inner = out.svg; }
      else { out = genericFace(G.EQ_W, h, d, uid, isRear); inner = out.svg; }

      body += `<g transform="translate(${G.RAIL},${y.toFixed(1)})">${inner}</g>`;

      if (isRear && out && out.anchors) {
        const abs = out.anchors.map((a) => ({ ...a, x: a.x + G.RAIL, y: a.y + y }));
        if (d.type === 'switch' && d.role) switchAnchors[d.role] = (switchAnchors[d.role] || []).concat(abs);
        else if (d.type === 'gpu' || d.type === 'dgx') nodeAnchors.push(...abs);
      }

      if (opts.showLabels) {
        const cy = y + (d.ru * G.U) / 2;
        const span = d.ru > 1 ? `U${d.uTop - d.ru + 1}–${d.uTop}` : `U${d.uTop}`;
        labels += text(gutter - 24, cy - 0.5, clip(d.name, 22), 'var(--text-primary)', 9, 'end', 600);
        labels += text(gutter - 24, cy + 8.5, clip(`${d.detail} · ${span}`, 30), 'var(--text-muted)', 7.2, 'end');
        labels += `<line x1="${gutter - 20}" y1="${cy}" x2="${gutter - 4}" y2="${cy}" stroke="var(--border-strong)" stroke-width="1"/>`;
      }
    });

    if (isRear && opts.showCables) {
      const colours = { ew: '#2a78d6', ns: '#eb6834', oob: '#1baf7a' };
      const counters = {};
      nodeAnchors.forEach((a) => {
        const targets = switchAnchors[a.fabric];
        if (!targets || !targets.length) return;
        const i = counters[a.fabric] = (counters[a.fabric] || 0);
        counters[a.fabric]++;
        const t = targets[i % targets.length];
        const lane = G.RACK_W + 12 + (a.fabric === 'ew' ? 0 : a.fabric === 'ns' ? 30 : 60) + (i % 6) * 2.2;
        const d = `M${a.x.toFixed(1)},${a.y.toFixed(1)} C${G.RACK_W - 4},${a.y.toFixed(1)} ${lane.toFixed(1)},${a.y.toFixed(1)} ${lane.toFixed(1)},${((a.y + t.y) / 2).toFixed(1)} C${lane.toFixed(1)},${t.y.toFixed(1)} ${G.RACK_W - 4},${t.y.toFixed(1)} ${t.x.toFixed(1)},${t.y.toFixed(1)}`;
        cables += `<path d="${d}" fill="none" stroke="${colours[a.fabric]}" stroke-width="1.2" opacity="0.6" stroke-linecap="round"/>`;
      });
    }

    return `<svg class="ra-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"
      aria-label="${esc(rack.name)} ${esc(side)} elevation">${defs(uid)}${labels}<g transform="translate(${gutter},0)">${fr}${body}${cables}</g></svg>`;
  }

  return { renderRack, G, C };
})();
