/* WEKA sizing tool — UI wiring and rendering. */

const $ = (id) => document.getElementById(id);
let LAST = null;

/* ---------- formatting ---------- */
const nf = (n, d = 0) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
function fmtCap(tb) {
  if (tb >= 1000) return { value: nf(tb / 1000, 2), unit: 'PB' };
  return { value: nf(tb, 1), unit: 'TB' };
}
const capStr = (tb) => { const c = fmtCap(tb); return `${c.value} ${c.unit}`; };
function fmtIops(n) {
  if (n >= 1e6) return `${nf(n / 1e6, 2)}M`;
  if (n >= 1e3) return `${nf(n / 1e3, 0)}K`;
  return nf(n, 0);
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- select helpers ---------- */
function fill(sel, items, selected) {
  sel.innerHTML = items.map((i) => `<option value="${esc(i.value)}">${esc(i.label)}</option>`).join('');
  if (selected != null && items.some((i) => i.value === selected)) sel.value = selected;
}

function populateVendors() {
  fill($('vendor'), Object.entries(VENDORS).map(([k, v]) => ({ value: k, label: v.label })), 'lenovo');
}

function populateServers() {
  const vendor = $('vendor').value;
  const items = Object.entries(SERVERS)
    .filter(([, s]) => s.vendor === vendor)
    .map(([k, s]) => ({ value: k, label: s.label }));
  const keep = items.some((i) => i.value === $('server').value) ? $('server').value : items[0].value;
  fill($('server'), items, keep);
  populateServerDependents();
}

function populateServerDependents() {
  const s = SERVERS[$('server').value];
  $('server-note').textContent = `${s.sublabel} · ${s.ru}U · ${s.bays.min}–${s.bays.max} data bays · min ${s.minCluster} nodes · source: ${s.src}`;

  // Keep the current choice when the new server still offers it, else fall back to
  // that server's documented default rather than whatever happens to be first.
  const keep = (cur, valid, fallback) => (valid.includes(cur) ? cur : fallback);

  fill($('cpu'), s.cpuOptions.map((c) => ({ value: c.id, label: `${c.label} — ${c.cores} cores` })), $('cpu').value);
  fill($('ram'), s.ramOptionsGB.map((g) => ({ value: String(g), label: `${g} GB` })), $('ram').value);
  fill($('drive'), s.driveKeys.map((k) => ({ value: k, label: DRIVES[k].label })),
    keep($('drive').value, s.driveKeys, s.defaultDrive));
  fill($('nic'), s.nicKeys.map((k) => ({ value: k, label: NICS[k].label })),
    keep($('nic').value, s.nicKeys, s.defaultNic));

  const sw = VENDORS[s.vendor].switchKeys;
  fill($('switch'), sw.map((k) => ({ value: k, label: SWITCHES[k].label })), $('switch').value);

  const d = $('drives');
  d.min = s.bays.min;
  d.max = s.bays.max;
  d.value = Math.min(Math.max(+d.value, s.bays.min), s.bays.max);
  $('drives-val').textContent = d.value;

  $('nicCount').max = s.maxDataNics + 1;
}

function populateStatic() {
  fill($('workload'), Object.entries(WORKLOADS).map(([k, v]) => ({ value: k, label: v.label })), 'ai-training');
  fill($('scheme'), PROTECTION_SCHEMES.map((s) => ({
    value: s.id,
    label: `${s.id}  —  ${(s.efficiency * 100).toFixed(0)}% data, tolerates ${s.driveFailures} drive failures`,
  })), '8+2');
}

/* ---------- read state ---------- */
function readInput() {
  const manual = parseInt($('manualNodes').value, 10);
  return {
    serverKey: $('server').value,
    driveKey: $('drive').value,
    nicKey: $('nic').value,
    switchKey: $('switch').value,
    nicCount: +$('nicCount').value,
    cpuId: $('cpu').value,
    schemeId: $('scheme').value,
    workloadId: $('workload').value,
    drivesPerNode: +$('drives').value,
    ramGB: +$('ram').value,
    hotSpares: +$('spares').value,
    protocols: $('protocols').checked,
    rdma: $('rdma').checked,
    targetTB: Math.max(0, +$('targetTB').value || 0),
    targetReadGBps: Math.max(0, +$('targetGBps').value || 0),
    manualNodes: Number.isFinite(manual) && manual > 0 ? manual : null,
  };
}

/* ---------- charts ---------- */
function capacityStack(c) {
  const segs = [
    { label: 'Usable (net)', tb: c.netTB, color: 'var(--series-1)' },
    { label: 'Parity', tb: c.parityTB, color: 'var(--series-2)' },
    { label: 'Hot spare', tb: c.spareTB, color: 'var(--series-3)' },
    { label: 'WEKA reserve', tb: c.overheadTB, color: 'var(--border-strong)' },
  ].filter((s) => s.tb > 0);
  const total = c.rawTB || 1;

  const bars = segs.map((s) => `
    <div style="flex:${s.tb / total} 0 0;background:${s.color}" title="${esc(s.label)}: ${capStr(s.tb)}"></div>`).join('');
  const legend = segs.map((s) => `
    <div class="legend-item"><span class="swatch" style="background:${s.color}"></span>
      <span>${esc(s.label)} <b>${capStr(s.tb)}</b> <span style="color:var(--text-muted)">${((s.tb / total) * 100).toFixed(0)}%</span></span>
    </div>`).join('');

  return `<div class="stackbar">${bars}</div><div class="legend">${legend}</div>`;
}

function bottleneckBars(perNode) {
  const max = Math.max(...perNode.limits.map((l) => l.value));
  return `<div class="bars">${perNode.limits.map((l) => {
    const binding = l.id === perNode.bottleneck.id;
    return `<div class="bar-row ${binding ? 'binding' : ''}">
      <div class="name">${esc(l.label)}${binding ? '<div class="tag">binding limit</div>' : ''}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(l.value / max) * 100}%;background:${binding ? 'var(--series-2)' : 'var(--series-1)'};opacity:${binding ? 1 : 0.42}"></div></div>
      <div class="val">${nf(l.value, 1)} GB/s</div>
    </div>`;
  }).join('')}</div>`;
}

function scalingChart(points, current) {
  const W = 640, H = 250, ML = 62, MR = 16, MT = 14, MB = 46;
  const pw = W - ML - MR, ph = H - MT - MB;
  const maxN = Math.max(...points.map((p) => p.nodes));
  const minN = Math.min(...points.map((p) => p.nodes));
  const maxTB = Math.max(...points.map((p) => p.netTB)) * 1.08;
  const x = (n) => ML + ((n - minN) / Math.max(1, maxN - minN)) * pw;
  const y = (t) => MT + ph - (t / maxTB) * ph;

  // One unit for the whole axis, so ticks read as a single scale.
  const inPB = maxTB >= 1000;
  const axisUnit = inPB ? 'PB' : 'TB';
  const axisVal = (v) => (inPB ? nf(v / 1000, 1) : nf(v, 0));

  const ticks = 4;
  const grid = Array.from({ length: ticks + 1 }, (_, i) => {
    const v = (maxTB / ticks) * i;
    return `<line x1="${ML}" y1="${y(v)}" x2="${W - MR}" y2="${y(v)}" stroke="var(--grid)" stroke-width="1"/>
      <text x="${ML - 9}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--text-muted)">${axisVal(v)}${i === ticks ? ' ' + axisUnit : ''}</text>`;
  }).join('');

  const xticks = points.filter((_, i) => i % Math.ceil(points.length / 7) === 0 || i === points.length - 1)
    .map((p) => `<text x="${x(p.nodes)}" y="${H - 22}" text-anchor="middle" font-size="11" fill="var(--text-muted)">${p.nodes}</text>`).join('');

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.nodes).toFixed(1)},${y(p.netTB).toFixed(1)}`).join(' ');
  const area = `${line} L${x(maxN).toFixed(1)},${y(0)} L${x(minN).toFixed(1)},${y(0)} Z`;

  const marker = current.netTB > 0 && current.nodes >= minN && current.nodes <= maxN
    ? `<circle cx="${x(current.nodes)}" cy="${y(current.netTB)}" r="6" fill="var(--series-2)" stroke="var(--surface)" stroke-width="2"/>
       <text x="${x(current.nodes)}" y="${y(current.netTB) - 13}" text-anchor="middle" font-size="11.5" font-weight="600" fill="var(--text-primary)">this design</text>`
    : '';

  return `<div class="chart-wrap"><svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" role="img"
      aria-label="Net usable capacity as node count increases">
    ${grid}
    <path d="${area}" fill="var(--series-1)" opacity="0.12"/>
    <path d="${line}" fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${marker}
    <line x1="${ML}" y1="${MT + ph}" x2="${W - MR}" y2="${MT + ph}" stroke="var(--border-strong)" stroke-width="1"/>
    ${xticks}
    <text x="${ML + pw / 2}" y="${H - 4}" text-anchor="middle" font-size="11" fill="var(--text-muted)">backend nodes</text>
  </svg></div>`;
}

/* SPECstorage 2020 projection — audited reference points, scaled per node. */
function specCard(r) {
  const s = r.spec;
  if (!s) return '';
  const unit = s.meta.metric;
  const spread = s.range.high / Math.max(1, s.range.low);

  const refRows = s.rows.map((row) => {
    const q = row.ref;
    return `<tr class="${row === s.closest ? 'highlight' : ''}">
      <td>${esc(q.vendor)}<span class="sub">${esc(q.solution)}</span></td>
      <td class="num">${q.nodes}<span class="sub">${q.clients} clients</span></td>
      <td class="num">${q.drives} × ${q.driveTB} TB<span class="sub">PCIe Gen${q.drivePcie} · ${q.netGbPerNode} Gb/node</span></td>
      <td class="num">${nf(q.metric)}<span class="sub">${nf(row.perNode.metric, 0)} per node</span></td>
      <td class="num">${fmtIops(q.opsPerSec)}<span class="sub">${nf(q.mbPerSec / 1000, 1)} GB/s</span></td>
      <td class="num">${nf(q.ortMs, 2)} ms</td>
      <td class="num">${nf(row.projected.metric, 0)}</td>
    </tr>`;
  }).join('');

  return `<section class="card">
    <h2>SPECstorage 2020 projection — ${esc(s.meta.label)}</h2>
    <div class="hero" style="margin-bottom:16px">
      <div class="hero-figure">
        <div class="value">${nf(s.range.low, 0)}–${nf(s.range.high, 0)}</div>
        <div class="label">Projected ${esc(unit)} for ${r.nodes} nodes</div>
      </div>
      <div class="hero-figure">
        <div class="value">${nf(s.closest.projected.mbps / 1000, 0)}<span class="unit">GB/s</span></div>
        <div class="label">Workload throughput at the closest reference</div>
      </div>
      <div class="hero-figure">
        <div class="value">${nf(s.closest.ref.ortMs, 2)}<span class="unit">ms</span></div>
        <div class="label">Reference response time</div>
      </div>
    </div>
    <p style="font-size:12.5px;color:var(--text-secondary);margin:0 0 14px">${esc(s.meta.desc)}</p>
    <div class="table-scroll"><table>
      <thead><tr>
        <th>Audited reference</th><th class="num">Nodes</th><th class="num">Per-node hardware</th>
        <th class="num">Result</th><th class="num">Peak ops/s</th><th class="num">ORT</th>
        <th class="num">Scaled to ${r.nodes}</th>
      </tr></thead>
      <tbody>${refRows}</tbody>
    </table></div>
    <div class="sources" style="margin-top:14px">
      Audited results:
      ${s.rows.map((row) => `<a href="${esc(row.ref.url)}" target="_blank" rel="noopener">${esc(row.ref.vendor)}</a>`).join(' · ')}
    </div>
    <div class="card-note">
      Both rows are audited SPECstorage Solution 2020 submissions running WEKA on bare metal, scaled linearly by backend node count. The highlighted row is the closer hardware match to this design.
      ${spread > 1.4 ? `The two references disagree by ${nf(spread, 1)}× per node on this workload, which is why a range is shown rather than a single figure — ${esc(s.meta.label)} is sensitive to drive generation and core count, so a build resembling the highlighted row should land nearer that end.` : `The two references agree closely per node on this workload, so the projection is relatively insensitive to which hardware generation you pick.`}
      SPEC workloads are mixed read/write with metadata operations, so they run below the peak-sequential ceiling of ${nf(s.modelledPeakGBps, 1)} GB/s per node modelled above — that is expected, not a contradiction. Reaching these numbers also needs enough client hosts to drive the load.
    </div>
  </section>`;
}

/* ---------- render ---------- */
function render() {
  const input = readInput();
  const r = size(input);
  LAST = { input, r };

  const cap = fmtCap(r.capacity.netTB);
  const worst = r.warnings.some((w) => w.level === 'critical');

  const memRows = Object.entries({
    'Base (fixed)': r.mem.parts.fixed,
    [`Frontend processes (${r.mem.layout.frontendProcs})`]: r.mem.parts.frontend,
    [`Compute processes (${r.mem.layout.computeProcs})`]: r.mem.parts.compute,
    [`Drive processes (${r.mem.layout.driveProcs})`]: r.mem.parts.drive,
    'SSD capacity management': r.mem.parts.ssdManagement,
    [`Core allocation (${r.mem.layout.wekaCores} cores)`]: r.mem.parts.cores,
    'Operating system': r.mem.parts.os,
    'NFS / SMB / S3 protocols': r.mem.parts.protocols,
    'RDMA': r.mem.parts.rdma,
  }).filter(([, v]) => v > 0);

  const schemes = compareSchemes(input, r.nodes);
  const curve = scalingCurve(input, r.scheme, Math.max(r.nodes * 2, r.scheme.stripe + 24));

  $('results').innerHTML = `

  <section class="card">
    <div class="hero">
      <div class="hero-figure">
        <div class="value">${cap.value}<span class="unit">${cap.unit}</span></div>
        <div class="label">Usable (net) capacity</div>
      </div>
      <div class="hero-figure">
        <div class="value">${r.nodes}</div>
        <div class="label">Backend nodes — ${esc(r.server.label)}</div>
      </div>
      <div class="hero-figure">
        <div class="value">${nf(r.cluster.read, 0)}<span class="unit">GB/s</span></div>
        <div class="label">Estimated aggregate read</div>
      </div>
      <div class="hero-driver">${input.manualNodes ? 'Node count set manually' : 'Sized by: ' + esc(r.solved.driver)}</div>
    </div>
  </section>

  <div class="tiles">
    <div class="tile"><div class="v">${capStr(r.capacity.rawTB)}</div><div class="k">Raw capacity</div></div>
    <div class="tile"><div class="v">${nf(r.capacity.efficiencyPct, 1)}<small>%</small></div><div class="k">Raw → usable efficiency</div></div>
    <div class="tile"><div class="v">${esc(r.scheme.id)}</div><div class="k">Protection · tolerates ${r.scheme.driveFailures} drive / ${r.scheme.serverFailures} server failures</div></div>
    <div class="tile"><div class="v">${nf(r.cluster.write, 0)}<small>GB/s</small></div><div class="k">Estimated aggregate write</div></div>
    <div class="tile"><div class="v">${fmtIops(r.cluster.readIops)}</div><div class="k">Estimated read IOPS</div></div>
    <div class="tile"><div class="v">${nf(r.physical.powerW / 1000, 1)}<small>kW</small></div><div class="k">Estimated power draw</div></div>
    <div class="tile"><div class="v">${r.physical.ru}<small>U</small></div><div class="k">Rack units · ${r.physical.racksNeeded} rack${r.physical.racksNeeded > 1 ? 's' : ''}</div></div>
    <div class="tile"><div class="v">${r.nodes * r.drivesPerNode}</div><div class="k">Total NVMe drives</div></div>
  </div>

  <section class="card">
    <h2>Design checks</h2>
    ${r.warnings.length === 0
      ? `<div class="all-clear"><span class="icon">✓</span> No issues found. This configuration satisfies every documented WEKA and vendor constraint the tool checks.</div>`
      : `<div class="warn-list">${
          ['critical', 'warning', 'info'].flatMap((lvl) =>
            r.warnings.filter((w) => w.level === lvl).map((w) => `
              <div class="warn ${lvl}">
                <span class="icon">${lvl === 'critical' ? '✕' : lvl === 'warning' ? '!' : 'i'}</span>
                <div><div class="t">${esc(w.title)}</div><div class="d">${esc(w.detail)}</div></div>
              </div>`)
          ).join('')
        }</div>`}
    ${worst ? `<div class="card-note">Critical items above will prevent this cluster from being deployed as configured.</div>` : ''}
  </section>

  <section class="card">
    <h2>Where the raw capacity goes</h2>
    ${capacityStack(r.capacity)}
    <div class="table-scroll" style="margin-top:18px">
      <table>
        <thead><tr><th>Step</th><th class="num">Capacity</th><th>Applied</th></tr></thead>
        <tbody>
          <tr><td>Raw installed</td><td class="num">${capStr(r.capacity.rawTB)}</td><td>${r.nodes} nodes × ${r.drivesPerNode} × ${r.drive.tb} TB</td></tr>
          <tr><td>After hot spare reserve</td><td class="num">${capStr(r.capacity.afterSpare)}</td><td>× (${r.nodes} − ${input.hotSpares}) / ${r.nodes}</td></tr>
          <tr><td>After parity</td><td class="num">${capStr(r.capacity.afterParity)}</td><td>× ${r.scheme.d}/${r.scheme.stripe} &nbsp;(${r.scheme.id})</td></tr>
          <tr class="highlight"><td>Net usable</td><td class="num">${capStr(r.capacity.netTB)}</td><td>× 0.9 filesystem overhead</td></tr>
        </tbody>
      </table>
    </div>
    <div class="card-note">Formula: <strong>Net = Raw × (FD − spares)/FD × D/(D+P) × 0.9</strong>, where FD is the failure-domain count (one per server here). Published in Lenovo Press LP1698 and consistent with WEKA's planning documentation. WEKA licensing is billed on net capacity — this design falls in <strong>${esc(r.capacity.licenseTier)}</strong>.</div>
  </section>

  <div class="split">
    <section class="card">
      <h2>Per-node throughput ceiling</h2>
      ${bottleneckBars(r.perNode)}
      <div class="card-note">Per-node read throughput is capped by whichever resource is lowest — here <strong>${esc(r.perNode.bottleneck.label.toLowerCase())}</strong> at ${nf(r.perNode.read, 1)} GB/s per node. Write throughput is ${nf(r.perNode.write, 1)} GB/s per node after the ${r.scheme.id} parity cost.</div>
    </section>

    <section class="card">
      <h2>Capacity as the cluster grows</h2>
      ${scalingChart(curve, { nodes: r.nodes, netTB: r.capacity.netTB })}
      <div class="card-note">Net capacity with ${r.drivesPerNode} × ${r.drive.tb} TB per node at ${r.scheme.id} and ${input.hotSpares} hot spare${input.hotSpares === 1 ? '' : 's'}. Throughput scales on the same near-linear curve, since every backend serves clients directly.</div>
    </section>
  </div>

  <div class="split">
    <section class="card">
      <h2>Per-node configuration</h2>
      <div class="table-scroll"><table>
        <tbody>
          <tr><td>Server</td><td class="num">${esc(r.server.label)}<span class="sub">${esc(r.server.sublabel)}</span></td></tr>
          <tr><td>CPU</td><td class="num">${esc(r.cpu.label)}<span class="sub">${r.mem.layout.wekaCores} cores to WEKA, 1 to the OS, ${Math.max(0, r.cpu.cores - r.mem.layout.wekaCores - 1)} spare</span></td></tr>
          <tr><td>Memory</td><td class="num">${input.ramGB} GB installed<span class="sub">WEKA requires ≈ ${nf(r.mem.totalGiB, 1)} GiB</span></td></tr>
          <tr><td>Data drives</td><td class="num">${r.drivesPerNode} × ${r.drive.tb} TB<span class="sub">${esc(r.drive.label)} · PCIe Gen${r.drive.pcie} · ${r.drive.dwpd} DWPD</span></td></tr>
          <tr><td>Boot drives</td><td class="num">${WEKA.bootDrives.count} × ${WEKA.bootDrives.capacityGB} GB M.2<span class="sub">${esc(WEKA.bootDrives.note)}</span></td></tr>
          <tr><td>Data network</td><td class="num">${input.nicCount} × ${esc(r.nic.label)}<span class="sub">${nf(r.perNode.wireGbps, 0)} Gb/s per node · ${r.nic.rdma ? 'RDMA capable' : 'no RDMA'} · ${esc(r.nic.fabric)}</span></td></tr>
          <tr><td>Power supplies</td><td class="num">${esc(r.server.psu)}<span class="sub">≈ ${nf(r.server.typicalWatts, 0)} W typical draw</span></td></tr>
          <tr><td>Form factor</td><td class="num">${r.server.ru}U</td></tr>
        </tbody>
      </table></div>
    </section>

    <section class="card">
      <h2>Memory budget per node</h2>
      <div class="table-scroll"><table>
        <thead><tr><th>Component</th><th class="num">GiB</th></tr></thead>
        <tbody>
          ${memRows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${nf(v, 2)}</td></tr>`).join('')}
          <tr class="highlight"><td>Total required</td><td class="num">${nf(r.mem.totalGiB, 1)}</td></tr>
        </tbody>
      </table></div>
      <div class="card-note">Component values are WEKA's published per-server memory formula. Process layout follows WEKA's rule of one drive process per SSD up to six, then one per two SSDs, with two compute processes per drive process.</div>
    </section>
  </div>

  <section class="card">
    <h2>Cluster totals</h2>
    <div class="table-scroll"><table>
      <thead><tr><th>Item</th><th class="num">Value</th><th>Notes</th></tr></thead>
      <tbody>
        <tr><td>Backend nodes</td><td class="num">${r.nodes}</td><td>${esc(r.server.label)}, failure domains = ${r.nodes}</td></tr>
        <tr><td>Total NVMe drives</td><td class="num">${nf(r.nodes * r.drivesPerNode)}</td><td>plus ${nf(r.nodes * WEKA.bootDrives.count)} boot drives</td></tr>
        <tr><td>Total memory</td><td class="num">${nf(r.ratios.totalRamGB)} GB</td><td>storage-to-RAM ratio ${nf(r.ratios.storageToRam)}:1 (WEKA limit ${nf(WEKA.maxStorageToRamRatio)}:1)</td></tr>
        <tr><td>Fabric ports</td><td class="num">${r.physical.dataPorts}</td><td>${nf(r.network.totalWireGbps)} Gb/s aggregate wire rate</td></tr>
        <tr><td>Switches</td><td class="num">${r.physical.switchCount}</td><td>${esc(r.sw.label)}, redundant pair minimum</td></tr>
        <tr><td>Rack space</td><td class="num">${r.physical.ru + r.physical.switchCount * r.sw.ru}U</td><td>${r.physical.racksNeeded} rack${r.physical.racksNeeded > 1 ? 's' : ''} at 40U usable per rack</td></tr>
        <tr><td>Power</td><td class="num">${nf(r.physical.powerW / 1000, 1)} kW</td><td>${nf(r.physical.btuPerHr)} BTU/hr of cooling</td></tr>
        <tr><td>Aggregate read</td><td class="num">${nf(r.cluster.read, 0)} GB/s</td><td>${fmtIops(r.cluster.readIops)} IOPS</td></tr>
        <tr><td>Aggregate write</td><td class="num">${nf(r.cluster.write, 0)} GB/s</td><td>${fmtIops(r.cluster.writeIops)} IOPS</td></tr>
      </tbody>
    </table></div>
  </section>

  ${specCard(r)}

  <section class="card">
    <h2>Protection scheme trade-off at ${r.nodes} nodes</h2>
    <div class="table-scroll"><table>
      <thead><tr>
        <th>Scheme</th><th class="num">Net capacity</th><th class="num">Efficiency</th>
        <th class="num">Drive failures</th><th class="num">Min failure domains</th>
      </tr></thead>
      <tbody>${schemes.map((s) => `
        <tr class="${s.scheme.id === r.scheme.id ? 'highlight' : ''}">
          <td>${esc(s.scheme.id)}</td>
          <td class="num">${capStr(s.netTB)}</td>
          <td class="num">${nf(s.usablePct, 1)}%</td>
          <td class="num">${s.scheme.driveFailures}</td>
          <td class="num">${s.scheme.stripe}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>
    <div class="card-note">Only schemes whose stripe width fits inside ${r.nodes} failure domains are listed. Wider stripes yield more usable capacity but need a bigger cluster and rebuild across more nodes. The protection level cannot be changed after the cluster is formed.</div>
  </section>

  <section class="card sources">
    <h2>Sources &amp; assumptions</h2>
    <p><strong>${esc(r.vendor.full)}</strong><br>${esc(r.vendor.note)}</p>
    <ul>
      <li><a href="${esc(VENDORS.lenovo.doc)}" target="_blank" rel="noopener">Lenovo EveryScale Design Architecture for WEKA Storage (LP1698)</a> — server BOM, qualified drives and NICs, and the net-capacity formula with two worked examples this tool reproduces exactly.</li>
      <li><a href="${esc(VENDORS.hpe.doc)}" target="_blank" rel="noopener">HPE Solutions with WEKA (QuickSpecs a00001270enw)</a> — supported ProLiant and Alletra platforms, 8-server minimum, 100/200/400 Gb fabric options.</li>
      <li><a href="${esc(VENDORS.generic.doc)}" target="_blank" rel="noopener">WEKA — Planning a WEKA system installation</a> — protection scheme limits, per-server memory formula, process layout, drive and ratio constraints.</li>
      <li><a href="https://www.spec.org/storage2020/results/" target="_blank" rel="noopener">SPECstorage Solution 2020 published results</a> — the eight audited bare-metal WEKA submissions behind the workload projection above.</li>
    </ul>
    <div class="disclaimer">
      <strong>How to read the performance numbers.</strong> Capacity, memory and all constraint checks come straight from published formulas and limits, and the capacity maths reproduces Lenovo's worked examples exactly. Two different performance figures are shown, and they answer different questions. The <strong>peak sequential</strong> estimate takes the lowest of the network, drive and CPU ceilings per node; it is calibrated against WEKA's published eight-node benchmark to within about 2%, and represents a best case with large sequential IO. The <strong>SPECstorage projection</strong> scales audited third-party results by node count and represents realistic mixed workloads, which is why it is lower. Neither is a guarantee: real results depend on IO size, client count, file sizes and tuning. Confirm any committed design with WEKA and your hardware vendor before quoting.
    </div>
  </section>`;
}

/* ---------- export ---------- */
function exportCSV() {
  if (!LAST) return;
  const { input, r } = LAST;
  const rows = [
    ['WEKA storage sizing'],
    ['Generated', new Date().toISOString().slice(0, 10)],
    [],
    ['Requirement'],
    ['Workload', r.workload.label],
    ['Target usable capacity (TB)', input.targetTB],
    ['Target read throughput (GB/s)', input.targetReadGBps],
    [],
    ['Result'],
    ['Vendor', r.vendor.label],
    ['Server model', r.server.label],
    ['Backend nodes', r.nodes],
    ['Sizing driver', input.manualNodes ? 'manual override' : r.solved.driver],
    ['Protection scheme', r.scheme.id],
    ['Hot spares', input.hotSpares],
    ['Raw capacity (TB)', r.capacity.rawTB.toFixed(1)],
    ['Net usable capacity (TB)', r.capacity.netTB.toFixed(1)],
    ['Efficiency (%)', r.capacity.efficiencyPct.toFixed(1)],
    ['License tier', r.capacity.licenseTier],
    [],
    ['Per node'],
    ['CPU', r.cpu.label],
    ['Cores to WEKA', r.mem.layout.wekaCores],
    ['Memory installed (GB)', input.ramGB],
    ['Memory required (GiB)', r.mem.totalGiB.toFixed(1)],
    ['Data drives', `${r.drivesPerNode} x ${r.drive.tb} TB`],
    ['Drive model', r.drive.label],
    ['Network adapters', `${input.nicCount} x ${r.nic.label}`],
    ['Wire rate per node (Gb/s)', r.perNode.wireGbps],
    ['Read throughput (GB/s)', r.perNode.read.toFixed(1)],
    ['Binding limit', r.perNode.bottleneck.label],
    [],
    ['Cluster totals'],
    ['Total NVMe drives', r.nodes * r.drivesPerNode],
    ['Total memory (GB)', r.ratios.totalRamGB],
    ['Storage-to-RAM ratio', `${Math.round(r.ratios.storageToRam)}:1`],
    ['Fabric ports', r.physical.dataPorts],
    ['Switches', `${r.physical.switchCount} x ${r.sw.label}`],
    ['Rack units', r.physical.ru],
    ['Power (kW)', (r.physical.powerW / 1000).toFixed(1)],
    ['Aggregate read (GB/s)', r.cluster.read.toFixed(0)],
    ['Aggregate write (GB/s)', r.cluster.write.toFixed(0)],
    ['Aggregate read IOPS', Math.round(r.cluster.readIops)],
    [],
    ['SPECstorage 2020 projection'],
    ['Workload', r.spec ? r.spec.meta.label : 'n/a'],
    ...(r.spec ? [
      [`Projected ${r.spec.meta.metric} (low)`, Math.round(r.spec.range.low)],
      [`Projected ${r.spec.meta.metric} (high)`, Math.round(r.spec.range.high)],
      ...r.spec.rows.map((row) => [
        `Reference: ${row.ref.vendor}`,
        `${row.ref.nodes} nodes, ${row.ref.metric} ${r.spec.meta.metric}, ${Math.round(row.perNode.metric)}/node`,
        row.ref.url,
      ]),
    ] : []),
    [],
    ['Design checks'],
    ...r.warnings.map((w) => [w.level, w.title, w.detail]),
  ];
  const csv = rows.map((row) => row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `weka-sizing-${r.vendor.label.toLowerCase()}-${r.nodes}n.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------- wiring ---------- */
function bind() {
  $('vendor').addEventListener('change', () => { populateServers(); render(); });
  $('server').addEventListener('change', () => { populateServerDependents(); render(); });

  ['drives', 'spares', 'nicCount'].forEach((id) => {
    $(id).addEventListener('input', () => { $(`${id}-val`).textContent = $(id).value; render(); });
  });

  ['cpu', 'ram', 'drive', 'nic', 'switch', 'scheme', 'workload'].forEach((id) => {
    $(id).addEventListener('change', render);
  });
  ['targetTB', 'targetGBps', 'manualNodes'].forEach((id) => {
    $(id).addEventListener('input', render);
  });
  ['rdma', 'protocols'].forEach((id) => $(id).addEventListener('change', render));

  $('workload').addEventListener('change', () => {
    $('workload-note').textContent = WORKLOADS[$('workload').value].note;
  });
  $('scheme').addEventListener('change', () => {
    const s = PROTECTION_SCHEMES.find((x) => x.id === $('scheme').value);
    $('scheme-note').textContent = `Needs at least ${s.stripe} failure domains. ${(s.efficiency * 100).toFixed(0)}% of raw goes to data.`;
  });
  $('drives').addEventListener('input', () => {
    const s = SERVERS[$('server').value];
    $('drives-hint').textContent = `${s.label} supports ${s.bays.min}–${s.bays.max} data bays.`;
  });

  $('btn-print').addEventListener('click', () => window.print());
  $('btn-csv').addEventListener('click', exportCSV);
  $('btn-theme').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : cur === 'light' ? 'dark' : (matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', next);
  });
}

populateStatic();
populateVendors();
populateServers();
bind();
$('workload-note').textContent = WORKLOADS[$('workload').value].note;
$('scheme-note').textContent = (() => {
  const s = PROTECTION_SCHEMES.find((x) => x.id === $('scheme').value);
  return `Needs at least ${s.stripe} failure domains. ${(s.efficiency * 100).toFixed(0)}% of raw goes to data.`;
})();
$('drives-hint').textContent = (() => {
  const s = SERVERS[$('server').value];
  return `${s.label} supports ${s.bays.min}–${s.bays.max} data bays.`;
})();
render();
