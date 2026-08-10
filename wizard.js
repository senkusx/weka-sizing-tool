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

  <section class="card">${storageTable(weka, fac)}</section>

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
  </section>`;

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
