/* Guided sizing journey: compute -> networking -> storage -> results. */

const $w = (id) => document.getElementById(id);
const escW = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nfW = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const bigW = (n) => (n >= 1e6 ? `${nfW(n / 1e6, 2)}M` : n >= 1e3 ? `${nfW(n / 1e3, 1)}k` : nfW(n, 0));

const STEPS = ['Compute', 'Networking', 'Storage', 'Results'];
let step = 0;
let STATE = null;
let rackView = 'front';

/* ---------- setup ---------- */
function fill() {
  $w('w-profile').innerHTML = Object.entries(RA_PROFILES).map(([k, v]) => `<option value="${k}">${escW(v.label)}</option>`).join('');
  $w('w-node').innerHTML = Object.entries(GPU_NODES).map(([k, v]) => `<option value="${k}">${escW(v.sublabel)}</option>`).join('');
  $w('w-model').innerHTML = Object.entries(MODELS).map(([k, v]) => `<option value="${k}">${escW(v.label)}</option>`).join('');
  $w('w-precision').innerHTML = Object.entries(PRECISIONS).map(([k, v]) => `<option value="${k}">${escW(v.label)}</option>`).join('');
  $w('w-scheme').innerHTML = PROTECTION_SCHEMES.map((s) => `<option value="${s.id}">${s.id} — ${(s.efficiency * 100).toFixed(0)}% efficient</option>`).join('');
  $w('w-pod').innerHTML = Object.entries(WEKAPODS)
    .map(([k, v]) => `<option value="${k}">${escW(v.label)}</option>`).join('');
  $w('w-pod').value = 'nitro-155';
  $w('w-profile').value = 'regional';
  $w('w-node').value = 'smc-b300';
  $w('w-model').value = 'llama31-70b';
  $w('w-precision').value = 'fp8';
  $w('w-scheme').value = WEKAPOD_DEFAULTS.schemeId;

  $w('stepper').innerHTML = STEPS.map((s, i) =>
    `<button data-goto="${i}"><span class="num">${i + 1}</span>${escW(s)}</button>`).join('');
  $w('stepper').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) go(+b.dataset.goto);
  });
}

/* ---------- compute the whole solution ---------- */
function computeAll() {
  const nodeKey = $w('w-node').value;
  const node = GPU_NODES[nodeKey];
  const coolSel = $w('w-cooling');
  const lcOpt = coolSel.querySelector('option[value="liquid"]');
  lcOpt.disabled = !node.liquidCapable;
  if (!node.liquidCapable && coolSel.value === 'liquid') coolSel.value = 'air';
  const coolingKey = coolSel.value;

  // Networking overrides feed the shared fabric rules.
  FABRIC_RULES.eastWestOversub = +$w('w-ew').value;
  FABRIC_RULES.northSouthOversub = +$w('w-ns').value;
  FABRIC_RULES.breakout = +$w('w-breakout').value;

  // Sizing basis: solve for the fleet, or fix it and report what it delivers.
  const basis = $w('w-basis').value;
  const perRack = RACK.cooling[coolingKey].gpuNodesPerRack;
  let fixedNodes = null;
  if (basis === 'nodes') fixedNodes = Math.max(1, +$w('w-nodes').value || 1);
  else if (basis === 'racks') fixedNodes = Math.max(1, +$w('w-racks').value || 1) * perRack;

  const inf = sizeInference({
    fixedNodes,
    modelKey: $w('w-model').value,
    precisionKey: $w('w-precision').value,
    nodeKey,
    concurrentRequests: Math.max(1, +$w('w-conc').value || 1),
    promptTokens: Math.max(1, +$w('w-prompt').value || 1),
    outputTokens: Math.max(1, +$w('w-out').value || 1),
    tpotTargetMs: +$w('w-tpot').value,
    ttftTargetMs: +$w('w-ttft').value,
    tpOverride: $w('w-tp').value ? +$w('w-tp').value : null,
    customModel: null,
  });
  if (inf.error) return { error: inf.error, inf };

  // --- storage: sized natively on the chosen WEKApod appliance ---
  const podKey = $w('w-pod').value;
  const schemeId = $w('w-scheme').value;
  const mode = $w('w-stmode').value;
  const gpus = inf.gpusDeployed;
  let stNodes;
  if (mode === 'ratio') {
    stNodes = wekapodNodesFor({ podKey, targetReadGBs: gpus * (+$w('w-gbpergpu').value), schemeId });
  } else if (mode === 'capacity') {
    stNodes = wekapodNodesFor({ podKey, targetTB: Math.max(10, +$w('w-captb').value || 10), schemeId });
  } else {
    stNodes = Math.max(WEKAPODS[podKey].minNodes, +$w('w-stnodes').value || 8);
  }
  const weka = sizeWekapod({ podKey, nodes: stNodes, schemeId });
  stNodes = weka.nodes;

  const fac = sizeFacility({
    gpuNodes: inf.nodes, nodeKey, coolingKey,
    profileKey: $w('w-profile').value, storageNodes: stNodes, storagePodKey: podKey,
  });
  const layout = buildRALayout(fac, { gpuNodes: inf.nodes });

  return { inf, fac, layout, weka, stNodes, mode, podKey, nodeKey, coolingKey, basis, perRack };
}

/* ---------- live strips under each step ---------- */
function tiles(items) {
  return `<div class="tiles">${items.map(([v, k]) =>
    `<div class="tile"><div class="v">${v}</div><div class="k">${escW(k)}</div></div>`).join('')}</div>`;
}

function renderLive() {
  const s = STATE;
  if (!s || s.error) {
    const msg = s && s.error ? s.error : 'Configuration cannot be sized.';
    ['live-compute', 'live-net', 'live-storage'].forEach((id) => {
      if ($w(id)) $w(id).innerHTML = `<div class="card"><div class="check-item critical"><span>${escW(msg)}</span></div></div>`;
    });
    return;
  }
  const { inf, fac } = s;

  $w('live-compute').innerHTML = tiles([
    [nfW(inf.gpusDeployed), `${inf.gpu.short} GPUs`],
    [nfW(inf.nodes), inf.fixedNodes ? 'GPU nodes (fixed)' : 'GPU nodes'],
    [nfW(inf.deployedConcurrency), inf.shortfall ? 'Concurrency — SHORT' : 'Concurrency served'],
    [`${nfW(inf.perUserTps, 1)}<small>tok/s</small>`, 'Per user'],
    [`${bigW(inf.clusterTps)}<small>tok/s</small>`, 'Cluster throughput'],
    [`${nfW(inf.ttftMs, 0)}<small>ms</small>`, 'TTFT'],
    [`TP ${inf.tp} · batch ${nfW(inf.batch)}`, `Limited by ${inf.batchLimit}`],
  ]);

  const fb = fac.fabric;
  $w('live-net').innerHTML = tiles([
    [nfW(fb.ewLeaves + fb.ewSpines + fb.nsLeaves + fb.nsSpines), 'SN5610 switches'],
    [nfW(fb.oobLeaves + fb.oobSpines), 'OOB switches'],
    [nfW(fb.ewPorts), 'East-west node ports'],
    [`${nfW(fac.power.switchW / 1000, 1)}<small>kW</small>`, 'Fabric power'],
    [nfW(fac.fabricRacks), 'Fabric racks'],
  ]);

  const w = s.weka;
  $w('live-storage').innerHTML = tiles([
    [nfW(w.nodes), `${escW(w.pod.model)} nodes`],
    [`${nfW(w.netTB, 0)}<small>TB</small>`, 'Usable capacity'],
    [`${nfW(w.readGBs, 0)}<small>GB/s</small>`, 'Read throughput'],
    [`${nfW(w.readIops / 1e6, 1)}<small>M</small>`, 'Read IOPS'],
    [`${nfW(w.readGBs / Math.max(1, inf.gpusDeployed), 1)}<small>GB/s</small>`, 'Per GPU'],
    [`${nfW(w.ru)}<small>U</small>`, 'Rack units'],
  ]);
  const pod = WEKAPODS[$w('w-pod').value];
  $w('w-pod-hint').textContent = `${pod.ru}U · ${pod.drives} × ${pod.driveTB} TB ${pod.driveType} · ${pod.cpu} · ${nfW(pod.ramGB)} GB · ${pod.net} · ${pod.readGBs}/${pod.writeGBs} GB/s per node`;

  // Networking card detail.
  $w('net-summary').innerHTML = `<h2>Derived fabric</h2>
    <div class="table-scroll"><table><tbody>
      <tr><td>East-west</td><td class="num">${fb.ewLeaves} leaf + ${fb.ewSpines} spine</td></tr>
      <tr><td>North-south</td><td class="num">${fb.nsLeaves} leaf + ${fb.nsSpines} spine</td></tr>
      <tr><td>Out-of-band</td><td class="num">${fb.oobLeaves} leaf + ${fb.oobSpines} spine</td></tr>
      <tr><td>Switch rack units</td><td class="num">${fb.switchU} U</td></tr>
      <tr><td>East-west ports needed</td><td class="num">${nfW(fb.ewPorts)}</td></tr>
    </tbody></table></div>
    <div class="card-note">Counts are derived from the oversubscription rules above, not from a port map. On the 2 MW reference design this model derives 29 SN5610 against the 32 in the elevation.</div>`;

  $w('storage-summary').innerHTML = storageTable(w, fac);
}

/* Shared storage detail, used on the storage step and again in the results. */
function storageTable(w, fac) {
  const p = w.pod;
  const rows = [
    ['Appliance', `${p.family} — ${p.model}`],
    ['Nodes', `${nfW(w.nodes)} × ${p.ru}U = ${nfW(w.ru)}U`],
    ['NVMe per node', `${p.drives} × ${p.driveTB} TB ${p.driveType}`],
    p.writeTier ? ['Write tier', p.writeTier] : null,
    ['CPU / memory', `${p.cpu} · ${nfW(p.ramGB)} GB`],
    ['Data network', `${p.net} — ${nfW(w.ports)} × ${p.portGb} Gb total`],
    ['Raw capacity', `${nfW(w.rawTB, 0)} TB`],
    ['Usable capacity', `${nfW(w.netTB, 0)} TB`],
    ['Protection', `${w.scheme.id} + ${w.spares} virtual hot spare${w.spares === 1 ? '' : 's'} · ${(w.scheme.efficiency * 100).toFixed(0)}% efficient`],
    ['Read / write throughput', `${nfW(w.readGBs, 0)} / ${nfW(w.writeGBs, 0)} GB/s`],
    ['Read / write IOPS', `${nfW(w.readIops / 1e6, 1)}M / ${nfW(w.writeIops / 1e6, 1)}M`],
    ['Power', `${nfW(w.watts / 1000, 1)} kW`],
    ['Weight', `${nfW(w.weightKg, 0)} kg`],
    ['Storage racks', nfW(fac.storageRacks)],
  ].filter(Boolean);
  const ref = p.ref ? `<div class="card-note">Validated against WEKA's published configuration: ${p.ref.nodes} × ${escW(p.model)} = ${p.ref.netTB} TB usable at 5D+2P+1VHS, ${p.ref.readGBs}/${p.ref.writeGBs} GB/s, ${p.ref.ru}RU, ~${p.ref.kw} kW, ~${p.ref.kg} kg. This tool reproduces the capacity, rack units, power and weight exactly.</div>`
    : `<div class="card-note">${escW(p.src)}</div>`;
  return `<h2>WEKApod storage</h2><div class="table-scroll"><table><tbody>
    ${rows.map((r) => `<tr><td>${escW(r[0])}</td><td class="num">${escW(r[1])}</td></tr>`).join('')}
  </tbody></table></div>${ref}`;
}

/* ---------- detail cards carried over from the compute and storage pages ---------- */

function computeMemoryCard(r) {
  const wPer = r.weightsGB / r.tp;
  const kvPer = (r.batch * r.kvPerSeqGB) / r.tp;
  const ws = SERVING.workspaceGB;
  const total = r.gpuMemGB;
  const seg = (v, c) => `<div style="width:${Math.max(0, (v / total) * 100)}%;background:${c}"></div>`;
  return `<section class="card">
    <h2>Memory per GPU — ${escW(r.gpu.short)}, ${nfW(total)} GB ${escW(r.gpu.memType)}</h2>
    <div class="stackbar">${seg(wPer, 'var(--series-1)')}${seg(kvPer, 'var(--series-2)')}${seg(ws, 'var(--series-3)')}<div style="flex:1;background:var(--surface-2)"></div></div>
    <div class="legend">
      <div class="legend-item"><span class="swatch" style="background:var(--series-1)"></span>Weights ${nfW(wPer, 1)} GB</div>
      <div class="legend-item"><span class="swatch" style="background:var(--series-2)"></span>KV cache ${nfW(kvPer, 1)} GB</div>
      <div class="legend-item"><span class="swatch" style="background:var(--series-3)"></span>Workspace ${nfW(ws, 1)} GB</div>
      <div class="legend-item"><span class="swatch" style="background:var(--surface-2);border:1px solid var(--border)"></span>Free ${nfW(Math.max(0, total - r.perGpuMemGB), 1)} GB</div>
    </div>
    <div class="card-note">${escW(r.model.label)} at ${escW(r.precision.label)} is ${nfW(r.weightsGB, 1)} GB across ${r.tp} GPU${r.tp > 1 ? 's' : ''}. Each sequence costs ${nfW(r.kvPerSeqGB * 1024, 1)} MB of KV at ${nfW(r.ctxTokens)} tokens, sized on ${r.model.kvHeads} KV heads rather than ${r.model.heads} attention heads — grouped-query attention is what makes long context affordable.
    Batch is capped by <strong>${escW(r.batchLimit)}</strong>: KV memory would allow ${nfW(r.memBatch)}, the TPOT target allows ${nfW(r.tpotBatch)}.</div>
  </section>`;
}

function fabricCard(fac) {
  const fb = fac.fabric, sn = FABRIC.sn5610;
  const rows = [
    ['East-west leaf', `${fb.ewLeaves} × ${sn.label}`, `${fb.ewOversub}:1 non-blocking`, `${nfW(fb.ewPorts)} node ports`],
    ['East-west spine', fb.ewSpines ? `${fb.ewSpines} × ${sn.label}` : '— leaf pair interconnects directly', `${fb.ewOversub}:1`, '—'],
    ['North-south leaf', `${fb.nsLeaves} × ${sn.label}`, `${fb.nsOversub}:1`, `${nfW(fb.nsPorts)} node ports`],
    ['North-south spine', fb.nsSpines ? `${fb.nsSpines} × ${sn.label}` : '—', `${fb.nsOversub}:1`, '—'],
    ['Out-of-band leaf', `${fb.oobLeaves} × ${FABRIC.sn2201.label}`, 'dual-homed', `${nfW(fb.oobPorts)} ports`],
    ['Out-of-band spine', fb.oobSpines ? `${fb.oobSpines} × ${FABRIC.sn4600c.label}` : '—', '—', '—'],
  ];
  return `<section class="card"><h2>Fabric</h2>
    <div class="table-scroll"><table>
      <thead><tr><th>Layer</th><th>Switches</th><th>Oversubscription</th><th class="num">Server-facing</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${escW(r[0])}</td><td>${escW(r[1])}</td><td>${escW(r[2])}</td><td class="num">${escW(r[3])}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="card-note">Counts are derived from the reference architecture's oversubscription rules, with SN5610 cages treated as 2×400G because the BOM specifies MMS4X00-NS twin-port transceivers. On the 2 MW design this model derives 29 SN5610 against the 32 in the elevation — close, but not a substitute for a port map.</div>
  </section>`;
}

function capacityCard(w) {
  const pct = (v) => (v / w.rawTB) * 100;
  return `<section class="card">
    <h2>Where the raw capacity goes</h2>
    <div class="stackbar">
      <div style="width:${pct(w.split.net)}%;background:var(--series-1)"></div>
      <div style="width:${pct(w.split.parity)}%;background:var(--series-2)"></div>
      <div style="width:${pct(w.split.spare)}%;background:var(--series-3)"></div>
      <div style="width:${pct(w.split.reserve)}%;background:var(--surface-2)"></div>
    </div>
    <div class="legend">
      <div class="legend-item"><span class="swatch" style="background:var(--series-1)"></span>Usable ${nfW(w.split.net, 0)} TB · ${nfW(pct(w.split.net), 0)}%</div>
      <div class="legend-item"><span class="swatch" style="background:var(--series-2)"></span>Parity ${nfW(w.split.parity, 0)} TB</div>
      <div class="legend-item"><span class="swatch" style="background:var(--series-3)"></span>Hot spare ${nfW(w.split.spare, 0)} TB</div>
      <div class="legend-item"><span class="swatch" style="background:var(--surface-2);border:1px solid var(--border)"></span>WEKA reserve ${nfW(w.split.reserve, 0)} TB</div>
    </div>
    <div class="table-scroll" style="margin-top:14px"><table>
      <thead><tr><th>Step</th><th class="num">Capacity</th><th>Applied</th></tr></thead>
      <tbody>${w.waterfall.map((x) => `<tr><td${x.final ? ' style="font-weight:600"' : ''}>${escW(x.step)}</td><td class="num"${x.final ? ' style="font-weight:600"' : ''}>${nfW(x.tb, 1)} TB</td><td>${escW(x.applied)}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="card-note">Net = Raw × (FD − spares)/FD × D/(D+P) × 0.9, the formula published in Lenovo Press LP1698 and consistent with WEKA's planning documentation. Licensing is billed on net capacity — this design falls in <strong>${escW(w.licenseTier)}</strong>.</div>
  </section>`;
}

function storageNodeCard(w) {
  const p = w.pod;
  const c = w.ceiling;
  const memRows = [
    ['Base (fixed)', w.mem.base], ['Frontend processes', w.mem.frontend],
    ['Compute processes', w.mem.compute], ['Drive processes', w.mem.drives],
    ['SSD capacity management', w.mem.ssdMgmt], ['Core allocation', w.mem.cores],
    ['Operating system', w.mem.os], ['NFS / SMB / S3 protocols', w.mem.protocols],
    ['RDMA', w.mem.rdma],
  ].filter((r) => r[1] > 0);
  return `<section class="card">
    <h2>WEKApod node — configuration, memory and throughput ceiling</h2>
    <div class="two-col">
      <div>
        <div class="table-scroll"><table>
          <thead><tr><th>Per-node configuration</th><th class="num"></th></tr></thead>
          <tbody>
            <tr><td>Model</td><td class="num">${escW(p.model)}</td></tr>
            <tr><td>CPU</td><td class="num">${escW(p.cpu)}</td></tr>
            <tr><td>Memory</td><td class="num">${nfW(p.ramGB)} GB</td></tr>
            <tr><td>Data drives</td><td class="num">${p.drives} × ${p.driveTB} TB ${escW(p.driveType)}</td></tr>
            ${p.writeTier ? `<tr><td>Write tier</td><td class="num">${escW(p.writeTier)}</td></tr>` : ''}
            <tr><td>Boot</td><td class="num">${escW(p.bootDesc)}</td></tr>
            <tr><td>Data network</td><td class="num">${escW(p.net)}</td></tr>
            <tr><td>Management</td><td class="num">${escW(p.mgmt)}</td></tr>
            <tr><td>Form factor</td><td class="num">${p.ru}U</td></tr>
            <tr><td>Power</td><td class="num">${nfW(p.watts)} W</td></tr>
          </tbody>
        </table></div>
      </div>
      <div>
        <div class="table-scroll"><table>
          <thead><tr><th>Memory budget</th><th class="num">GiB</th></tr></thead>
          <tbody>
            ${memRows.map((r) => `<tr><td>${escW(r[0])}</td><td class="num">${nfW(r[1], 2)}</td></tr>`).join('')}
            <tr><td><strong>WEKA requires</strong></td><td class="num"><strong>${nfW(w.mem.totalGiB, 1)}</strong></td></tr>
            <tr><td>Installed</td><td class="num">${nfW((p.ramGB * 1e9) / 1024 ** 3, 1)}</td></tr>
          </tbody>
        </table></div>
      </div>
    </div>
    <div class="table-scroll" style="margin-top:14px"><table>
      <thead><tr><th>Per-node throughput ceiling</th><th class="num">GB/s</th></tr></thead>
      <tbody>${c.limits.map((l) => `<tr><td>${escW(l.label)}${l.id === c.bottleneck.id ? ' <span class="pill">binding</span>' : ''}</td><td class="num">${nfW(l.value, 1)}</td></tr>`).join('')}
        <tr><td><strong>Modelled read ceiling</strong></td><td class="num"><strong>${nfW(c.read, 1)}</strong></td></tr>
        <tr><td>WEKA published per node</td><td class="num">${nfW(p.readGBs, 0)}</td></tr>
      </tbody>
    </table></div>
    <div class="card-note">Memory follows WEKA's published per-server formula; the ceiling takes the lowest of the network, drive and CPU limits. The modelled ceiling sits ${c.read >= p.readGBs ? 'above' : 'below'} WEKA's published figure — a peak-sequential ceiling should sit above a real-world number.</div>
  </section>`;
}

function protectionCard(w) {
  return `<section class="card">
    <h2>Protection scheme trade-off at ${w.nodes} nodes</h2>
    <div class="table-scroll"><table>
      <thead><tr><th>Scheme</th><th class="num">Net capacity</th><th class="num">Efficiency</th><th class="num">Drive failures</th><th class="num">Min failure domains</th></tr></thead>
      <tbody>${w.alternatives.map((a) => `<tr${a.current ? ' class="highlight"' : ''}>
        <td${a.current ? ' style="font-weight:600"' : ''}>${escW(a.scheme.id)}</td>
        <td class="num">${nfW(a.netTB, 0)} TB</td>
        <td class="num">${(a.scheme.efficiency * 100).toFixed(1)}%</td>
        <td class="num">${a.scheme.driveFailures}</td>
        <td class="num">${a.scheme.stripe}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="card-note">Only schemes whose stripe width fits inside ${w.nodes} failure domains are listed. Wider stripes yield more usable capacity but rebuild across more nodes. Protection cannot be changed after the cluster is formed. Every level tolerates 2 simultaneous server failures.</div>
  </section>`;
}

function bomCard(r, fac, w) {
  const fb = fac.fabric;
  const rows = [
    [`${r.node.label} — ${r.node.sublabel}`, r.nodes, `${nfW(r.node.watts)} W`, `${nfW(r.node.weightKg, 1)} kg`],
    [r.gpu.label, r.gpusDeployed, `${nfW(r.gpu.tdpW)} W`, `${nfW(r.gpu.memGB)} GB ${r.gpu.memType}`],
    [`${w.pod.model} — ${w.pod.family}`, w.nodes, `${nfW(w.pod.watts)} W`, `${w.pod.drives} × ${w.pod.driveTB} TB`],
    [`${FABRIC.sn5610.label} — ${FABRIC.sn5610.desc}`, fb.ewLeaves + fb.ewSpines + fb.nsLeaves + fb.nsSpines, `${nfW(FABRIC.sn5610.watts)} W`, `${nfW(FABRIC.sn5610.weightKg, 1)} kg`],
    [`${FABRIC.sn2201.label} — OOB leaf`, fb.oobLeaves, `${nfW(FABRIC.sn2201.watts)} W`, `${nfW(FABRIC.sn2201.weightKg, 1)} kg`],
    fb.oobSpines ? [`${FABRIC.sn4600c.label} — OOB spine`, fb.oobSpines, `${nfW(FABRIC.sn4600c.watts)} W`, `${nfW(FABRIC.sn4600c.weightKg, 1)} kg`] : null,
    fac.cooling.cdu ? [INFRA.cdu.label, fac.computeRacks, `${nfW(INFRA.cdu.watts)} W`, `${nfW(INFRA.cdu.weightKg)} kg`] : null,
    [`${INFRA.tier2.label} — ${INFRA.tier2.model}`, fac.tier2Count, `${nfW(INFRA.tier2.watts)} W`, `${nfW(INFRA.tier2.weightKg)} kg`],
    [`Management rack (${RACK.mgmtRack.contents.length} devices)`, 1, `${nfW(RACK.mgmtRack.watts)} W`, `${nfW(RACK.mgmtRack.weightKg, 1)} kg`],
  ].filter(Boolean);
  return `<section class="card"><h2>Bill of materials</h2>
    <div class="table-scroll"><table>
      <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit power</th><th class="num">Unit spec</th></tr></thead>
      <tbody>${rows.map((x) => `<tr><td>${escW(x[0])}</td><td class="num">${nfW(x[1])}</td><td class="num">${escW(x[2])}</td><td class="num">${escW(x[3])}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="card-note">Part numbers and per-unit power come from the reference architecture BOM, the WEKApod material and NVIDIA datasheets.</div>
  </section>`;
}

function totalsCard(r, fac, w) {
  const rows = [
    ['GPU nodes', nfW(r.nodes), `${escW(r.node.sublabel)} · ${nfW(r.gpusDeployed)} GPUs`],
    ['Tensor parallel / replicas', `${r.tp} / ${nfW(r.deployedReplicas)}`, `batch ${nfW(r.batch)} per replica, limited by ${escW(r.batchLimit)}`],
    ['WEKApod nodes', nfW(w.nodes), `${nfW(w.drives)} NVMe drives · ${nfW(w.netTB, 0)} TB usable`],
    ['Fabric switches', nfW(fac.fabric.ewLeaves + fac.fabric.ewSpines + fac.fabric.nsLeaves + fac.fabric.nsSpines + fac.fabric.oobLeaves + fac.fabric.oobSpines), `${nfW(fac.fabric.ewPorts)} east-west node ports`],
    ['Racks', nfW(fac.totalRacks), `${fac.computeRacks} compute · ${fac.fabricRacks} fabric · ${fac.storageRacks} storage · 1 management`],
    ['Total IT load', `${nfW(fac.power.totalW / 1000, 1)} kW`, `${bigW(fac.coolingLoadBTU)} BTU/hr of cooling`],
    ['Total IT weight', `${nfW(fac.weight.totalKg / 1000, 2)} t`, `${nfW(fac.weight.totalKg, 0)} kg`],
    ['Per-rack feed', escW(RACK.feed), `${RACK.totalU}U × ${RACK.widthMM} × ${RACK.depthMM} mm`],
    ['Cluster throughput', `${bigW(r.clusterTps)} tok/s`, `${bigW(r.reqPerHour)} requests/hour at ${nfW(r.ctxTokens)} tokens`],
    ['Storage throughput', `${nfW(w.readGBs, 0)} / ${nfW(w.writeGBs, 0)} GB/s`, `${nfW(w.readIops / 1e6, 1)}M / ${nfW(w.writeIops / 1e6, 1)}M IOPS`],
  ];
  return `<section class="card"><h2>Cluster totals</h2>
    <div class="table-scroll"><table>
      <thead><tr><th>Item</th><th class="num">Value</th><th>Notes</th></tr></thead>
      <tbody>${rows.map((x) => `<tr><td>${escW(x[0])}</td><td class="num">${x[1]}</td><td>${x[2]}</td></tr>`).join('')}</tbody>
    </table></div>
  </section>`;
}

function sourcesCard() {
  return `<section class="card"><h2>Sources and method</h2>
    <ul class="sources">
      <li><strong>InferX reference architecture</strong> — node power, weight and rack composition. Verified against the elevations' own totals: air B300 rack 28,986 W, liquid rack 115,380 W, 128-node fleet 1,779,072 W, 64 compute racks air / 16 liquid.</li>
      <li><strong>WEKA NeuralMesh and WEKApod</strong> — appliance models and performance. The engine reproduces WEKA's published configurations exactly: 8 × WPS155-SAE = 484 TB usable, 568/256 GB/s, 18M/4.7M IOPS, 8RU, 6.4 kW, 74 kg.</li>
      <li><a href="https://lenovopress.lenovo.com/lp1698-lenovo-everyscale-design-architecture-for-weka-storage" target="_blank" rel="noopener">Lenovo Press LP1698</a> — the net-capacity formula, reproduced exactly on both of its worked examples.</li>
      <li><a href="https://docs.weka.io/planning-and-installation/bare-metal/planning-a-weka-system-installation" target="_blank" rel="noopener">WEKA planning documentation</a> — protection limits, per-server memory formula, process layout.</li>
      <li><a href="https://github.com/onepunk/open-gpu-db" target="_blank" rel="noopener">open-gpu-db</a> (Apache-2.0) — GPU specifications; its TDP figures independently agree with the RA BOM.</li>
      <li><a href="https://github.com/kkpkishan/llm-infra-planner" target="_blank" rel="noopener">LLMcalc</a> and <a href="https://github.com/onepunk/llmsizer" target="_blank" rel="noopener">llmsizer</a> (MIT) — memory and roofline formulas.</li>
    </ul>
    <div class="disclaimer">
      <strong>What is solid and what is not.</strong> Capacity, memory and facility figures are arithmetic from published formulas, and they reproduce the reference architecture's and WEKA's own numbers exactly. Inference <em>throughput</em> is a roofline model at ${Math.round(SERVING.bwEfficiency * 100)}% of peak bandwidth in decode and ${Math.round(SERVING.flopEfficiency * 100)}% of dense peak in prefill — the least-grounded numbers here, reflecting typical vLLM and TensorRT-LLM behaviour rather than a benchmark of this architecture. Fabric switch counts are derived from oversubscription rules, not a port map. Treat performance as a planning estimate and validate before committing to an SLA.
    </div>
  </section>`;
}

/* ---------- results ---------- */
function renderResults() {
  const s = STATE;
  if (!s || s.error) {
    $w('results').innerHTML = `<div class="card"><div class="check-item critical"><span>${escW(s ? s.error : 'Cannot size')}</span></div></div>`;
    return;
  }
  const { inf, fac, layout, weka } = s;
  const p = fac.power;

  // Racks of the same kind are identical bar the node numbering, and a core
  // design can run to dozens. Draw one of each and badge the repeat count
  // rather than emitting 68 near-identical SVGs the user must scroll past.
  const groups = [];
  layout.racks.forEach((rk) => {
    const sig = rk.kind + '|' + rk.devices.map((d) => `${d.type}:${d.ru}@${d.uTop}`).join(',');
    const hit = groups.find((g) => g.sig === sig);
    if (hit) hit.count++; else groups.push({ sig, rack: rk, count: 1 });
  });

  const racksHtml = (side) => groups.map((g, i) => `
    <div class="ra-rack-unit">
      <div class="ra-name">${escW(g.rack.name.replace(/ \d+$/, ''))}${g.count > 1 ? ` <span style="color:var(--accent)">× ${g.count}</span>` : ''}</div>
      <div class="ra-sub">${g.rack.devices.reduce((a, d) => a + d.ru, 0)}U used${g.count > 1 ? ` · ${g.count} identical racks` : ''}</div>
      ${RARack.renderRack(g.rack, side, { totalU: RACK.totalU, showLabels: true, showCables: true, showBlanks: true }, `${side}${i}`)}
    </div>`).join('');

  $w('results').innerHTML = `
  <section class="card">
    <div class="hero">
      <div class="hero-figure"><div class="value">${nfW(inf.gpusDeployed)}</div>
        <div class="label">${escW(inf.gpu.short)} GPUs · ${nfW(inf.nodes)} nodes</div></div>
      <div class="hero-figure"><div class="value">${nfW(fac.totalRacks)}<span class="unit">racks</span></div>
        <div class="label">${fac.computeRacks} compute · ${fac.fabricRacks} fabric · ${fac.storageRacks} storage · 1 mgmt</div></div>
      <div class="hero-figure"><div class="value">${nfW(p.totalW / 1000, 0)}<span class="unit">kW</span></div>
        <div class="label">Total IT load</div></div>
      <div class="hero-figure"><div class="value">${bigW(inf.clusterTps)}<span class="unit">tok/s</span></div>
        <div class="label">Cluster throughput</div></div>
      <div class="hero-driver">${escW(inf.model.label)} · ${escW(inf.precision.label)} · ${escW(fac.cooling.label)}</div>
    </div>
  </section>

  <section class="card">
    <h2>Solution summary</h2>
    <div class="table-scroll"><table>
      <thead><tr><th>Domain</th><th>Configuration</th><th class="num">Power</th><th class="num">Racks</th></tr></thead>
      <tbody>
        <tr><td><strong>Compute</strong></td><td>${nfW(inf.nodes)} × ${escW(inf.node.label)} (${escW(inf.node.sublabel)}), ${nfW(inf.gpusDeployed)} GPUs, TP ${inf.tp}, ${nfW(inf.deployedReplicas)} replicas</td><td class="num">${nfW(p.gpuNodeW / 1000, 1)} kW</td><td class="num">${fac.computeRacks}</td></tr>
        <tr><td><strong>Networking</strong></td><td>${fac.fabric.ewLeaves + fac.fabric.ewSpines} SN5610 east-west (${fac.fabric.ewOversub}:1), ${fac.fabric.nsLeaves + fac.fabric.nsSpines} north-south (${fac.fabric.nsOversub}:1), ${fac.fabric.oobLeaves + fac.fabric.oobSpines} OOB</td><td class="num">${nfW(p.switchW / 1000, 1)} kW</td><td class="num">${fac.fabricRacks}</td></tr>
        <tr><td><strong>Storage</strong></td><td>${nfW(weka.nodes)} × ${escW(weka.pod.model)} (${nfW(weka.ru)}U) · ${nfW(weka.netTB, 0)} TB usable at ${escW(weka.scheme.id)}+${weka.spares}VHS · ${nfW(weka.readGBs, 0)}/${nfW(weka.writeGBs, 0)} GB/s · plus ${fac.tier2Count} × Tier 2 block storage</td><td class="num">${nfW(p.storageW / 1000, 1)} kW</td><td class="num">${fac.storageRacks}</td></tr>
        <tr><td><strong>Platform</strong></td><td>Management rack — routers, platform servers, Tier 3, OOB firewalls, break-glass</td><td class="num">${nfW(p.mgmtW / 1000, 1)} kW</td><td class="num">1</td></tr>
        ${fac.cooling.cdu ? `<tr><td><strong>Cooling</strong></td><td>${fac.computeRacks} × ${escW(INFRA.cdu.label)}</td><td class="num">${nfW(p.cduW / 1000, 1)} kW</td><td class="num">—</td></tr>` : ''}
        <tr><td colspan="2"><strong>Total</strong></td><td class="num"><strong>${nfW(p.totalW / 1000, 1)} kW</strong></td><td class="num"><strong>${fac.totalRacks}</strong></td></tr>
      </tbody>
    </table></div>
  </section>

  <section class="card">
    <h2>Performance and facility</h2>
    <div class="tiles">
      <div class="tile"><div class="v">${nfW(inf.perUserTps, 1)}<small>tok/s</small></div><div class="k">Per-user speed</div></div>
      <div class="tile"><div class="v">${nfW(inf.tpotMs, 1)}<small>ms</small></div><div class="k">TPOT</div></div>
      <div class="tile"><div class="v">${nfW(inf.ttftMs, 0)}<small>ms</small></div><div class="k">TTFT</div></div>
      <div class="tile"><div class="v">${bigW(inf.reqPerHour)}</div><div class="k">Requests / hour</div></div>
      <div class="tile"><div class="v">${nfW(inf.deployedConcurrency)}</div><div class="k">Concurrency served</div></div>
      <div class="tile"><div class="v">${nfW(weka.readGBs / Math.max(1, inf.gpusDeployed), 1)}<small>GB/s</small></div><div class="k">Storage read per GPU</div></div>
      <div class="tile"><div class="v">${nfW(fac.weight.totalKg / 1000, 1)}<small>t</small></div><div class="k">Total IT weight</div></div>
      <div class="tile"><div class="v">${bigW(fac.coolingLoadBTU)}<small>BTU/hr</small></div><div class="k">Heat rejection</div></div>
      <div class="tile"><div class="v">${nfW(p.rackWithTier2W / 1000, 1)}<small>kW</small></div><div class="k">Rack w/ Tier 2 (first ${fac.tier2Count})</div></div>
      <div class="tile"><div class="v">${nfW(p.rackPlainW / 1000, 1)}<small>kW</small></div><div class="k">Rack without Tier 2</div></div>
      <div class="tile"><div class="v">${escW(RACK.feed)}</div><div class="k">Per-rack feed</div></div>
    </div>
  </section>

  ${computeMemoryCard(inf)}
  ${fabricCard(fac)}
  <section class="card">${storageTable(weka, fac)}</section>
  ${capacityCard(weka)}
  ${storageNodeCard(weka)}
  ${protectionCard(weka)}
  ${bomCard(inf, fac, weka)}
  ${totalsCard(inf, fac, weka)}

  ${inf.notes.length ? `<section class="card"><h2>Design checks</h2>
    ${[...inf.notes].sort((a, b) => ({ critical: 0, warning: 1, info: 2 }[a.level] - { critical: 0, warning: 1, info: 2 }[b.level]))
      .map((n) => `<div class="check-item ${escW(n.level)}"><span>${escW(n.text)}</span></div>`).join('')}
  </section>` : ''}

  <section class="card">
    <h2>Rack elevations — ${nfW(layout.racks.length)} racks, ${nfW(groups.length)} distinct layout${groups.length > 1 ? 's' : ''}</h2>
    <div class="view-toggle">
      <button data-view="front" class="${rackView === 'front' ? 'on' : ''}">Front</button>
      <button data-view="rear" class="${rackView === 'rear' ? 'on' : ''}">Rear + cabling</button>
      <span style="font-size:12.5px;color:var(--text-muted);margin-left:8px">
        ${rackView === 'rear' ? 'Blue east-west · orange north-south · green out-of-band' : `Drawn to the real unit — ${escW(inf.node.label)} at ${layout.nodeRu}U${fac.cooling.cdu ? ' (DLC chassis)' : ''}, WEKApod as a 2U four-node chassis`}
      </span>
    </div>
    <div class="ra-rack-row">${racksHtml(rackView)}</div>
    <div class="card-note">
      Elevations follow the reference architecture: fixed management rack, ${fac.cooling.gpuNodesPerRack} GPU nodes per ${escW(fac.cooling.label.toLowerCase())} rack${fac.cooling.cdu ? ' with a 250 kW CDU at the base' : ''}, switch fabric ordered out-of-band then north-south then east-west, and WEKApod chassis stacked from the top of the storage rack. Unoccupied units are drawn as blanking panels, as in the source elevations.
      Cabling is a planning sketch, not a wiring schedule.
    </div>
  </section>

  ${sourcesCard()}`;

  $w('results').querySelectorAll('.view-toggle button').forEach((b) =>
    b.addEventListener('click', () => { rackView = b.dataset.view; renderResults(); }));
}

/* ---------- navigation ---------- */
function go(n) {
  step = Math.max(0, Math.min(STEPS.length - 1, n));
  document.querySelectorAll('.step').forEach((el) => { el.hidden = +el.dataset.step !== step; });
  $w('stepper').querySelectorAll('button').forEach((b, i) => {
    b.classList.toggle('active', i === step);
    b.classList.toggle('done', i < step);
  });
  $w('w-back').disabled = step === 0;
  $w('w-next').textContent = step === STEPS.length - 1 ? 'Done' : 'Next →';
  $w('w-next').disabled = step === STEPS.length - 1;
  $w('w-pos').textContent = `Step ${step + 1} of ${STEPS.length} — ${STEPS[step]}`;
  if (step === STEPS.length - 1) renderResults();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function refresh() {
  $w('w-tpot-val').textContent = $w('w-tpot').value;
  $w('w-ttft-val').textContent = $w('w-ttft').value;
  $w('w-gbpergpu-val').textContent = $w('w-gbpergpu').value;

  // Nodes and racks are two views of the same quantity, so only one is editable;
  // the other is locked and shows what it works out to.
  const basis = $w('w-basis').value;
  const byNodes = basis === 'nodes';
  const byRacks = basis === 'racks';
  $w('w-nodes').disabled = !byNodes;
  $w('w-racks').disabled = !byRacks;
  $w('f-nodes').classList.toggle('locked', !byNodes);
  $w('f-racks').classList.toggle('locked', !byRacks);
  const coolNow = $w('w-cooling').value;
  const perRackNow = RACK.cooling[coolNow].gpuNodesPerRack;
  $w('w-basis-hint').textContent = basis === 'workload'
    ? 'Concurrency and the latency target decide the fleet; both fields below are derived.'
    : byNodes ? 'Node count is fixed; rack count follows from the cooling choice.'
      : 'Rack count is fixed; node count follows from the cooling choice.';
  $w('w-racks-hint').textContent = `${perRackNow} GPU nodes per ${coolNow === 'liquid' ? 'DLC' : 'air-cooled'} rack.`;

  const mode = $w('w-stmode').value;
  $w('f-ratio').hidden = mode !== 'ratio';
  $w('f-cap').hidden = mode !== 'capacity';
  $w('f-manual').hidden = mode !== 'manual';

  const prof = RA_PROFILES[$w('w-profile').value];
  const node = GPU_NODES[$w('w-node').value];
  $w('w-profile-hint').textContent = prof.desc;
  $w('w-node-hint').textContent = `${node.ru}U · ${node.gpuCount}× ${GPUS[node.gpuKey].short} · ${nfW(node.watts)} W · ${nfW(node.weightKg, 1)} kg · ${node.cpu}`;
  $w('w-cool-hint').textContent = node.liquidCapable
    ? `Air puts 2 nodes in a rack; DLC puts 8 in ${node.ruLiquid || node.ru}U chassis with a 250 kW CDU.`
    : `${node.sublabel} is air-cooled only.`;
  const m = MODELS[$w('w-model').value];
  $w('w-model-hint').textContent = `${(m.params / 1e9).toFixed(1)}B params${m.moe ? ` (${(m.activeParams / 1e9).toFixed(1)}B active)` : ''} · ${m.layers} layers · ${m.kvHeads} KV heads`;

  STATE = computeAll();
  // Reflect the solved figures back into whichever field is locked.
  if (STATE && !STATE.error) {
    if (!byNodes) $w('w-nodes').value = STATE.inf.nodes;
    if (!byRacks) $w('w-racks').value = STATE.fac.computeRacks;
  }
  renderLive();
  if (step === STEPS.length - 1) renderResults();
}

function exportCSV() {
  if (!STATE || STATE.error) return;
  const { inf, fac, weka, stNodes } = STATE;
  const rows = [
    ['InferX guided sizing'], ['Generated', new Date().toISOString()], [],
    ['Compute'],
    ['Model', inf.model.label], ['Precision', inf.precision.label],
    ['GPU node', `${inf.node.label} (${inf.node.sublabel})`],
    ['Nodes', inf.nodes], ['GPUs', inf.gpusDeployed], ['Tensor parallel', inf.tp],
    ['Batch per replica', inf.batch], ['Batch limited by', inf.batchLimit],
    ['Per-user tok/s', inf.perUserTps.toFixed(1)], ['TPOT ms', inf.tpotMs.toFixed(1)],
    ['TTFT ms', inf.ttftMs.toFixed(0)], ['Cluster tok/s', Math.round(inf.clusterTps)],
    ['Concurrency served', inf.deployedConcurrency],
    [],
    ['Networking'],
    ['East-west', `${fac.fabric.ewLeaves} leaf + ${fac.fabric.ewSpines} spine @ ${fac.fabric.ewOversub}:1`],
    ['North-south', `${fac.fabric.nsLeaves} leaf + ${fac.fabric.nsSpines} spine @ ${fac.fabric.nsOversub}:1`],
    ['Out-of-band', `${fac.fabric.oobLeaves} leaf + ${fac.fabric.oobSpines} spine`],
    [],
    ['Storage'],
    ['Appliance', `${weka.pod.family} ${weka.pod.model}`],
    ['Nodes', weka.nodes], ['Rack units', weka.ru],
    ['NVMe per node', `${weka.pod.drives} x ${weka.pod.driveTB} TB ${weka.pod.driveType}`],
    ['Raw TB', weka.rawTB.toFixed(0)], ['Usable TB', weka.netTB.toFixed(0)],
    ['Protection', `${weka.scheme.id}+${weka.spares}VHS`],
    ['Read GB/s', weka.readGBs.toFixed(0)], ['Write GB/s', weka.writeGBs.toFixed(0)],
    ['Read IOPS', Math.round(weka.readIops)], ['Write IOPS', Math.round(weka.writeIops)],
    ['Storage kW', (weka.watts / 1000).toFixed(1)], ['Storage kg', weka.weightKg.toFixed(0)],
    [],
    ['Facility'],
    ['Cooling', fac.cooling.label], ['Total racks', fac.totalRacks],
    ['Compute racks', fac.computeRacks], ['Fabric racks', fac.fabricRacks],
    ['Storage racks', fac.storageRacks],
    ['Total IT kW', (fac.power.totalW / 1000).toFixed(1)],
    ['Per compute rack kW', (fac.power.perComputeRackW / 1000).toFixed(1)],
    ['Total weight kg', fac.weight.totalKg.toFixed(0)],
    ['Cooling BTU/hr', Math.round(fac.coolingLoadBTU)],
    [],
    ['Design checks'], ...inf.notes.map((n) => [n.level, n.text]),
  ];
  const csv = rows.map((r) => r.map((c) => {
    const v = String(c ?? '');
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'inferx-guided-sizing.csv'; a.click();
  URL.revokeObjectURL(url);
}

fill();
document.querySelectorAll('.wizard select, .wizard input').forEach((el) => {
  el.addEventListener('input', refresh);
  el.addEventListener('change', refresh);
});
$w('w-back').addEventListener('click', () => go(step - 1));
$w('w-next').addEventListener('click', () => go(step + 1));
$w('btn-print').addEventListener('click', () => window.print());
$w('btn-csv').addEventListener('click', exportCSV);
$w('btn-theme').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  document.documentElement.setAttribute('data-theme',
    cur === 'dark' ? 'light' : cur === 'light' ? 'dark'
      : (matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark'));
});

refresh();
go(0);
