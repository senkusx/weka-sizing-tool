/* Compute sizing page — form wiring and rendering. */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nf = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const big = (n) => (n >= 1e6 ? `${nf(n / 1e6, 1)}M` : n >= 1e3 ? `${nf(n / 1e3, 1)}k` : nf(n, 0));

let LAST = null;

function fillSelects() {
  $('profile').innerHTML = Object.entries(RA_PROFILES)
    .map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
  $('node').innerHTML = Object.entries(GPU_NODES)
    .map(([k, v]) => `<option value="${k}">${esc(v.sublabel)}</option>`).join('');
  $('model').innerHTML = Object.entries(MODELS)
    .map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
  $('precision').innerHTML = Object.entries(PRECISIONS)
    .map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
  $('profile').value = 'regional';
  $('node').value = 'smc-b300';
  $('model').value = 'llama31-70b';
  $('precision').value = 'fp8';
}

function readInput() {
  return {
    profileKey: $('profile').value,
    nodeKey: $('node').value,
    coolingKey: $('cooling').value,
    modelKey: $('model').value,
    precisionKey: $('precision').value,
    concurrentRequests: Math.max(1, +$('concurrent').value || 1),
    promptTokens: Math.max(1, +$('promptTokens').value || 1),
    outputTokens: Math.max(1, +$('outputTokens').value || 1),
    tpotTargetMs: +$('tpot').value,
    ttftTargetMs: +$('ttft').value,
    tpOverride: $('tp').value ? +$('tp').value : null,
    wekapods: Math.max(0, +$('wekapods').value || 0),
    basis: $('basis').value,
    fixedNodesInput: Math.max(1, +$('fixedNodes').value || 1),
    fixedRacksInput: Math.max(1, +$('fixedRacks').value || 1),
    customModel: null,
  };
}

/* ---------- cards ---------- */
function heroCard(r, f) {
  return `<section class="card">
    <div class="hero">
      <div class="hero-figure">
        <div class="value">${nf(r.gpusDeployed)}</div>
        <div class="label">${esc(r.gpu.short)} GPUs across ${nf(r.nodes)} node${r.nodes > 1 ? 's' : ''}${r.fixedNodes ? ' (fixed)' : ''}</div>
      </div>
      <div class="hero-figure">
        <div class="value" style="${r.shortfall ? 'color:var(--warning)' : ''}">${nf(r.deployedConcurrency)}</div>
        <div class="label">Concurrent requests carried${r.shortfall ? ' — short of target' : ''}</div>
      </div>
      <div class="hero-figure">
        <div class="value">${nf(f.totalRacks)}<span class="unit">racks</span></div>
        <div class="label">${f.computeRacks} compute · ${f.fabricRacks} fabric · ${f.storageRacks} storage · ${f.mgmtRacks} mgmt</div>
      </div>
      <div class="hero-figure">
        <div class="value">${nf(f.power.totalW / 1000, 0)}<span class="unit">kW</span></div>
        <div class="label">Total IT load</div>
      </div>
      <div class="hero-driver">TP ${r.tp} · batch ${r.batch} · ${r.deployedReplicas} replica${r.deployedReplicas > 1 ? 's' : ''}</div>
    </div>
  </section>`;
}

function perfCard(r) {
  const tiles = [
    ['Per-user speed', `${nf(r.perUserTps, 1)}<small>tok/s</small>`, 'What one request sees'],
    ['TPOT', `${nf(r.tpotMs, 1)}<small>ms</small>`, 'Time per output token'],
    ['TTFT', `${nf(r.ttftMs, 0)}<small>ms</small>`, 'Prefill, compute bound'],
    ['Cluster throughput', `${big(r.clusterTps)}<small>tok/s</small>`, 'Aggregate decode'],
    ['Requests / hour', big(r.reqPerHour), `At ${nf(r.ctxTokens)} tokens each`],
    ['Concurrency served', nf(r.deployedConcurrency), `${nf(r.batch)} per replica`],
  ];
  return `<section class="card">
    <h2>Delivered performance</h2>
    <div class="tiles">
      ${tiles.map(([k, v, s]) => `<div class="tile"><div class="v">${v}</div><div class="k">${esc(k)}</div><div class="k" style="opacity:.7">${esc(s)}</div></div>`).join('')}
    </div>
    <div class="card-note">
      Decode is memory-bandwidth bound: each step streams the active weights once plus the KV cache of every sequence in the batch, so per-user speed falls as batch grows while aggregate throughput rises. Batch here is capped by <strong>${esc(r.batchLimit)}</strong> — KV memory would allow ${nf(r.memBatch)}, the TPOT target allows ${nf(r.tpotBatch)}.
      Prefill is compute bound at 2 FLOPs per active parameter per prompt token.
    </div>
  </section>`;
}

function memoryCard(r) {
  const weightsPerGpu = r.weightsGB / r.tp;
  const kvPerGpu = (r.batch * r.kvPerSeqGB) / r.tp;
  const ws = SERVING.workspaceGB;
  const total = r.gpuMemGB;
  const seg = (v, c, l) => `<div style="width:${(v / total) * 100}%;background:${c}" title="${l}"></div>`;
  return `<section class="card">
    <h2>Memory per GPU — ${esc(r.gpu.short)}, ${nf(total)} GB ${esc(r.gpu.memType)}</h2>
    <div style="display:flex;height:26px;border-radius:6px;overflow:hidden;border:1px solid var(--border);margin-bottom:12px">
      ${seg(weightsPerGpu, 'var(--series-1)', 'Weights')}
      ${seg(kvPerGpu, 'var(--series-2)', 'KV cache')}
      ${seg(ws, 'var(--series-3)', 'Workspace')}
      <div style="flex:1;background:var(--surface-2)"></div>
    </div>
    <div class="legend">
      <div class="legend-item"><span class="swatch" style="background:var(--series-1)"></span>Weights ${nf(weightsPerGpu, 1)} GB</div>
      <div class="legend-item"><span class="swatch" style="background:var(--series-2)"></span>KV cache ${nf(kvPerGpu, 1)} GB</div>
      <div class="legend-item"><span class="swatch" style="background:var(--series-3)"></span>Workspace ${nf(ws, 1)} GB</div>
      <div class="legend-item"><span class="swatch" style="background:var(--surface-2);border:1px solid var(--border)"></span>Free ${nf(Math.max(0, total - r.perGpuMemGB), 1)} GB</div>
    </div>
    <div class="card-note">
      Full model at ${esc(r.precision.label)} is ${nf(r.weightsGB, 1)} GB across ${r.tp} GPU${r.tp > 1 ? 's' : ''}. Each sequence costs ${nf(r.kvPerSeqGB * 1024, 1)} MB of KV at ${nf(r.ctxTokens)} tokens, sized on ${r.model.kvHeads} KV heads rather than ${r.model.heads} attention heads — grouped-query attention is what makes long context affordable.
    </div>
  </section>`;
}

function facilityCard(f, input) {
  const p = f.power;
  const rows = [
    ['GPU compute nodes', `${nf(p.gpuNodeW / 1000, 1)} kW`],
    f.cooling.cdu ? ['CDUs', `${nf(p.cduW / 1000, 1)} kW`] : null,
    p.tier2W ? [`Tier 2 block storage (${f.tier2Count} unit${f.tier2Count > 1 ? 's' : ''})`, `${nf(p.tier2W / 1000, 1)} kW`] : null,
    ['Fabric switching', `${nf(p.switchW / 1000, 1)} kW`],
    p.storageW ? ['WEKApod storage', `${nf(p.storageW / 1000, 1)} kW`] : null,
    ['Management rack', `${nf(p.mgmtW / 1000, 1)} kW`],
  ].filter(Boolean);

  return `<section class="card">
    <h2>Facility</h2>
    <div class="tiles" style="margin-bottom:16px">
      <div class="tile"><div class="v">${nf(f.totalRacks)}</div><div class="k">Racks, ${RACK.totalU}U ${RACK.widthMM}×${RACK.depthMM} mm</div></div>
      <div class="tile"><div class="v">${nf(p.rackWithTier2W / 1000, 1)}<small>kW</small></div><div class="k">Compute rack with Tier 2 (first ${f.tier2Count})</div></div>
      <div class="tile"><div class="v">${nf(p.rackPlainW / 1000, 1)}<small>kW</small></div><div class="k">Compute rack without</div></div>
      <div class="tile"><div class="v">${nf(f.weight.totalKg / 1000, 1)}<small>t</small></div><div class="k">Total IT weight</div></div>
      <div class="tile"><div class="v">${big(f.coolingLoadBTU)}<small>BTU/hr</small></div><div class="k">Heat rejection</div></div>
      <div class="tile"><div class="v">${nf(f.rackUsedPct, 0)}<small>%</small></div><div class="k">Compute rack U used (${f.rackU} of ${RACK.totalU})</div></div>
      <div class="tile"><div class="v">${esc(RACK.feed)}</div><div class="k">Per-rack power feed</div></div>
    </div>
    <div class="table-scroll"><table>
      <thead><tr><th>Power draw</th><th class="num">Load</th></tr></thead>
      <tbody>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v}</td></tr>`).join('')}
        <tr><td><strong>Total IT load</strong></td><td class="num"><strong>${nf(p.totalW / 1000, 1)} kW</strong></td></tr>
      </tbody>
    </table></div>
    <div class="card-note">
      Rack composition follows the reference architecture exactly: ${f.cooling.gpuNodesPerRack} GPU nodes per ${esc(f.cooling.label.toLowerCase())} rack${f.cooling.cdu ? ' alongside a 250 kW CDU' : ''}, with Tier 2 block storage at the base of the first ${f.tier2Count} compute rack${f.tier2Count > 1 ? 's' : ''} only — the reference designs carry exactly ${RACK.tier2Units} Tier 2 units regardless of how many racks they run to, which is why the elevations quote two different compute-rack totals.
      ${f.cooling.cdu ? '' : `At ${nf(p.rackPlainW / 1000, 1)} kW the air-cooled rack sits well inside what a ${esc(RACK.feed)} feed could carry, so the two-node limit is a thermal and fabric choice rather than a power one.`}
      Heat rejection is the IT load converted at 3.412 BTU/hr per watt and excludes facility overhead — apply your target PUE on top.
    </div>
  </section>`;
}

function fabricCard(f) {
  const fb = f.fabric;
  const sn = FABRIC.sn5610;
  const rows = [
    ['East-west leaf', `${fb.ewLeaves} × ${sn.label}`, `${fb.ewOversub}:1 non-blocking`, `${nf(fb.ewPorts)} node ports`],
    ['East-west spine', `${fb.ewSpines} × ${sn.label}`, `${fb.ewOversub}:1`, '—'],
    ['North-south leaf', `${fb.nsLeaves} × ${sn.label}`, `${fb.nsOversub}:1`, `${nf(fb.nsPorts)} node ports`],
    ['North-south spine', `${fb.nsSpines} × ${sn.label}`, `${fb.nsOversub}:1`, '—'],
    ['OOB leaf', `${fb.oobLeaves} × ${FABRIC.sn2201.label}`, 'dual-homed', `${nf(fb.oobPorts)} ports`],
    ['OOB spine', fb.oobSpines ? `${fb.oobSpines} × ${FABRIC.sn4600c.label}` : '—', '—', '—'],
  ];
  return `<section class="card">
    <h2>Fabric</h2>
    <div class="table-scroll"><table>
      <thead><tr><th>Layer</th><th>Switches</th><th>Oversubscription</th><th class="num">Server-facing</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td class="num">${esc(r[3])}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="card-note">
      Switch counts are <strong>derived</strong> from the reference architecture's oversubscription rules — east-west 1:1 non-blocking, north-south 4:1 — with SN5610 cages treated as 2×400G because the BOM specifies MMS4X00-NS twin-port transceivers. They are not read from a port map, so a detailed design may differ by a switch or two; on the 2 MW core design this model derives 29 SN5610 against the 32 in the elevation.
    </div>
  </section>`;
}

function checksCard(r) {
  if (!r.notes.length) {
    return `<section class="card"><h2>Design checks</h2><div class="check-item good"><span>All checks passed.</span></div></section>`;
  }
  const order = { critical: 0, warning: 1, info: 2 };
  const notes = [...r.notes].sort((a, b) => order[a.level] - order[b.level]);
  return `<section class="card">
    <h2>Design checks</h2>
    ${notes.map((n) => `<div class="check-item ${esc(n.level)}"><span>${esc(n.text)}</span></div>`).join('')}
  </section>`;
}

function bomCard(r, f, input) {
  const rows = [
    [`${esc(r.node.label)} — ${esc(r.node.sublabel)}`, r.nodes, `${nf(r.node.watts)} W`, `${nf(r.node.weightKg, 1)} kg`],
    [`${esc(r.gpu.label)}`, r.gpusDeployed, `${nf(r.gpu.tdpW)} W`, `${nf(r.gpu.memGB)} GB`],
    [`${FABRIC.sn5610.label} — ${FABRIC.sn5610.desc}`, f.fabric.ewLeaves + f.fabric.ewSpines + f.fabric.nsLeaves + f.fabric.nsSpines, `${nf(FABRIC.sn5610.watts)} W`, `${nf(FABRIC.sn5610.weightKg, 1)} kg`],
    [`${FABRIC.sn2201.label} — OOB leaf`, f.fabric.oobLeaves, `${nf(FABRIC.sn2201.watts)} W`, `${nf(FABRIC.sn2201.weightKg, 1)} kg`],
    f.fabric.oobSpines ? [`${FABRIC.sn4600c.label} — OOB spine`, f.fabric.oobSpines, `${nf(FABRIC.sn4600c.watts)} W`, `${nf(FABRIC.sn4600c.weightKg, 1)} kg`] : null,
    input.wekapods ? [`${INFRA.wekapod.label}`, input.wekapods, `${nf(INFRA.wekapod.watts)} W`, `${nf(INFRA.wekapod.weightKg, 1)} kg`] : null,
    f.cooling.cdu ? [`${INFRA.cdu.label}`, f.computeRacks, `${nf(INFRA.cdu.watts)} W`, `${nf(INFRA.cdu.weightKg, 1)} kg`] : null,
    f.profile.storage === 'tier2' ? [`${INFRA.tier2.label} — ${INFRA.tier2.model}`, f.computeRacks, `${nf(INFRA.tier2.watts)} W`, `${nf(INFRA.tier2.weightKg, 1)} kg`] : null,
    [`Management rack (${RACK.mgmtRack.contents.length} devices)`, 1, `${nf(RACK.mgmtRack.watts)} W`, `${nf(RACK.mgmtRack.weightKg, 1)} kg`],
  ].filter(Boolean);
  return `<section class="card">
    <h2>Bill of materials</h2>
    <div class="table-scroll"><table>
      <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit power</th><th class="num">Unit weight / spec</th></tr></thead>
      <tbody>${rows.map((x) => `<tr><td>${x[0]}</td><td class="num">${nf(x[1])}</td><td class="num">${x[2]}</td><td class="num">${x[3]}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="card-note">Part numbers and per-unit power come from the reference architecture BOM and rack elevations.</div>
  </section>`;
}

function sourcesCard(r) {
  return `<section class="card">
    <h2>Sources and method</h2>
    <ul class="sources">
      <li><strong>Node power, weight, rack composition</strong> — InferX reference architecture elevations and BOM. Verified against their own totals: air B300 rack 28,986 W, liquid rack 115,380 W, 128-node fleet 1,779,072 W.</li>
      <li><a href="https://github.com/onepunk/open-gpu-db" target="_blank" rel="noopener">open-gpu-db</a> (Apache-2.0) — GPU specifications. Its TDP figures independently agree with the BOM (B300 1400 W, RTX PRO 6000 600 W). It carries no bandwidth data, so bandwidth and dense low-precision compute come from NVIDIA's published specs.</li>
      <li><a href="https://github.com/kkpkishan/llm-infra-planner" target="_blank" rel="noopener">LLMcalc</a> (MIT) — memory and roofline formulas: weights, KV cache, activation and throughput.</li>
      <li><a href="https://github.com/onepunk/llmsizer" target="_blank" rel="noopener">llmsizer</a> (MIT) — quantisation-aware sizing and tensor-parallel scaling behaviour.</li>
    </ul>
    <div class="disclaimer">
      <strong>What is solid and what is not.</strong> Memory arithmetic is exact — weights and KV cache follow directly from the model architecture, and the facility roll-up reproduces the reference architecture's own rack and power totals. The <em>performance</em> figures are a roofline model: ${Math.round(SERVING.bwEfficiency * 100)}% of peak bandwidth in decode and ${Math.round(SERVING.flopEfficiency * 100)}% of dense peak in prefill. Those two efficiency factors are the least-grounded numbers here — they reflect typical vLLM and TensorRT-LLM behaviour, not a benchmark of this reference architecture. Real throughput depends on the serving stack, scheduling, chunked prefill and speculative decoding. Treat throughput as a planning estimate and validate against a benchmark before committing to an SLA.
    </div>
  </section>`;
}

/* ---------- render ---------- */
function render() {
  const input = readInput();
  $('tpot-val').textContent = input.tpotTargetMs;
  $('ttft-val').textContent = input.ttftTargetMs;

  const profile = RA_PROFILES[input.profileKey];
  const node = GPU_NODES[input.nodeKey];
  $('profile-hint').textContent = profile.desc;
  $('node-hint').textContent = `${node.ru}U · ${node.gpuCount}× ${GPUS[node.gpuKey].short} · ${nf(node.watts)} W · ${node.cpu} · ${nf(node.ramGB)} GB RAM`;
  const m = MODELS[input.modelKey];
  $('model-hint').textContent = `${(m.params / 1e9).toFixed(1)}B params${m.moe ? ` (${(m.activeParams / 1e9).toFixed(1)}B active)` : ''} · ${m.layers} layers · ${m.kvHeads} KV heads · ${nf(m.ctxMax)} ctx`;

  // Liquid cooling is only offered where the node supports it.
  const coolSel = $('cooling');
  const lc = coolSel.querySelector('option[value="liquid"]');
  lc.disabled = !node.liquidCapable;
  lc.textContent = node.liquidCapable
    ? 'Direct liquid cooled — 8 nodes/rack + CDU'
    : 'Direct liquid cooled — not available for this node';
  if (!node.liquidCapable && coolSel.value === 'liquid') coolSel.value = 'air';

  // Sizing basis. Nodes and racks are two views of the same quantity, so only
  // one is editable; the other is locked and shows what it works out to.
  const perRack = RACK.cooling[coolSel.value].gpuNodesPerRack;
  const byNodes = input.basis === 'nodes';
  const byRacks = input.basis === 'racks';
  $('fixedNodes').disabled = !byNodes;
  $('fixedRacks').disabled = !byRacks;
  $('f-nodes').classList.toggle('locked', !byNodes);
  $('f-racks').classList.toggle('locked', !byRacks);
  $('basis-hint').textContent = input.basis === 'workload'
    ? 'Concurrency and the latency target decide the fleet; both fields below are derived.'
    : byNodes ? 'Node count is fixed; rack count follows from the cooling choice.'
      : 'Rack count is fixed; node count follows from the cooling choice.';
  $('racks-hint').textContent = `${perRack} GPU nodes per ${coolSel.value === 'liquid' ? 'DLC' : 'air-cooled'} rack.`;
  input.fixedNodes = byNodes ? input.fixedNodesInput
    : byRacks ? input.fixedRacksInput * perRack : null;

  const r = sizeInference(input);
  if (r.error) {
    $('results').innerHTML = `<section class="card"><h2>Cannot size this configuration</h2>
      <div class="check-item critical"><span>${esc(r.error)}</span></div></section>`;
    LAST = null;
    return;
  }

  const f = sizeFacility({
    gpuNodes: r.nodes, nodeKey: input.nodeKey, coolingKey: coolSel.value,
    profileKey: input.profileKey, storageNodes: input.wekapods,
  });

  if (r.nodes < profile.minGpuNodes) {
    r.notes.push({ level: 'info', text: `The ${profile.label} profile assumes at least ${profile.minGpuNodes} GPU nodes; this workload needs ${r.nodes}. The smaller footprint is fine, but the profile's fabric and storage assumptions may be heavier than required.` });
  }

  // Reflect the solved figures back into whichever field is locked.
  if (!byNodes) $('fixedNodes').value = r.nodes;
  if (!byRacks) $('fixedRacks').value = f.computeRacks;

  LAST = { input, r, f };
  // Published for the rack elevation page.
  try {
    localStorage.setItem('inferx-compute-config', JSON.stringify({
      ...input, coolingKey: coolSel.value, gpuNodes: r.nodes,
    }));
  } catch (e) { /* private mode */ }

  $('results').innerHTML = [
    heroCard(r, f), perfCard(r), memoryCard(r),
    facilityCard(f, input), fabricCard(f), bomCard(r, f, input),
    checksCard(r), sourcesCard(r),
  ].join('');
}

function exportCSV() {
  if (!LAST) return;
  const { input, r, f } = LAST;
  const rows = [
    ['InferX compute sizing'],
    ['Generated', new Date().toISOString()],
    [],
    ['Workload'],
    ['Model', r.model.label], ['Precision', r.precision.label],
    ['Prompt tokens', input.promptTokens], ['Output tokens', input.outputTokens],
    ['Concurrent requests', input.concurrentRequests],
    ['TPOT target ms', input.tpotTargetMs], ['TTFT target ms', input.ttftTargetMs],
    [],
    ['Compute'],
    ['GPU node', `${r.node.label} (${r.node.sublabel})`],
    ['Nodes', r.nodes], ['GPUs', r.gpusDeployed], ['GPU model', r.gpu.label],
    ['Tensor parallel', r.tp], ['Batch per replica', r.batch], ['Batch limited by', r.batchLimit],
    ['Replicas', r.deployedReplicas], ['Concurrency served', r.deployedConcurrency],
    [],
    ['Performance (modelled)'],
    ['Per-user tokens/sec', r.perUserTps.toFixed(1)],
    ['TPOT ms', r.tpotMs.toFixed(1)], ['TTFT ms', r.ttftMs.toFixed(0)],
    ['Cluster tokens/sec', Math.round(r.clusterTps)],
    ['Requests/hour', Math.round(r.reqPerHour)],
    [],
    ['Facility'],
    ['Cooling', f.cooling.label],
    ['Total racks', f.totalRacks], ['Compute racks', f.computeRacks],
    ['Fabric racks', f.fabricRacks], ['Storage racks', f.storageRacks],
    ['Total IT load kW', (f.power.totalW / 1000).toFixed(1)],
    ['Per compute rack kW', (f.power.perComputeRackW / 1000).toFixed(1)],
    ['Total weight kg', f.weight.totalKg.toFixed(0)],
    ['Cooling load BTU/hr', Math.round(f.coolingLoadBTU)],
    [],
    ['Fabric'],
    ['East-west leaf', f.fabric.ewLeaves], ['East-west spine', f.fabric.ewSpines],
    ['North-south leaf', f.fabric.nsLeaves], ['North-south spine', f.fabric.nsSpines],
    ['OOB leaf', f.fabric.oobLeaves], ['OOB spine', f.fabric.oobSpines],
    [],
    ['Design checks'],
    ...r.notes.map((n) => [n.level, n.text]),
  ];
  const csv = rows.map((row) => row.map((c) => {
    const s = String(c ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'inferx-compute-sizing.csv'; a.click();
  URL.revokeObjectURL(url);
}

fillSelects();
document.querySelectorAll('select, input').forEach((el) => {
  el.addEventListener('input', render);
  el.addEventListener('change', render);
});
$('btn-print').addEventListener('click', () => window.print());
$('btn-csv').addEventListener('click', exportCSV);
$('btn-theme').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : cur === 'light' ? 'dark'
    : (matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark');
  document.documentElement.setAttribute('data-theme', next);
});
render();
