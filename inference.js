/* Inference sizing engine — pure functions, no DOM.

   Method follows the formulas documented by LLMcalc (kkpkishan/llm-infra-planner,
   MIT) and llmsizer (onepunk/llmsizer, MIT):

     weights   = params x bytes_per_param
     KV cache  = 2 x layers x kv_heads x head_dim x bytes  (per token, per sequence)
     decode    = roofline on memory bandwidth
     prefill   = roofline on dense low-precision FLOPS

   The decode model is the standard batched one: each decode step streams the
   whole weight set once plus the KV of every sequence in the batch, so

     step_time    = (weights + batch x kv_per_seq) / effective_bandwidth
     cluster_tps  = batch / step_time
     per_user_tps = 1 / step_time

   Per-user speed therefore falls as batch grows while aggregate throughput
   rises — which is exactly the trade-off a TPOT service level pins down. */

const GiB = 1024 ** 3;

/* KV cache bytes for one token of one sequence. Two tensors (K and V) per
   layer, sized by the grouped-query KV head count rather than the full head
   count — the difference is large on modern models. */
function kvBytesPerToken(model, precision) {
  return 2 * model.layers * model.kvHeads * model.headDim * precision.kvBytes;
}

/* Weight footprint in bytes, including packing overhead. MoE models must hold
   every expert resident even though only a few activate per token. */
function weightBytes(model, precision) {
  return model.params * precision.bytes * SERVING.weightOverhead;
}

/* Tensor-parallel efficiency. Splitting a model across N GPUs costs a fixed
   fraction per doubling, and costs far more without NVLink. */
function tpEfficiency(tp, nvlink) {
  if (tp <= 1) return 1;
  const loss = nvlink ? SERVING.tpScalingLoss : SERVING.tpScalingLossPcie;
  return Math.pow(1 - loss, Math.log2(tp));
}

/* Smallest tensor-parallel width that fits weights + workspace + a minimum KV
   allowance, constrained to powers of two and to whole nodes' worth of GPUs. */
function minTensorParallel({ model, precision, gpu, gpusPerNode, minKvGB }) {
  const wB = weightBytes(model, precision);
  const cap = gpu.memGB * GiB;
  const maxTp = gpusPerNode * 64; // allow scaling well beyond a single node
  for (let tp = 1; tp <= maxTp; tp *= 2) {
    const perGpu = wB / tp + SERVING.workspaceGB * GiB + (minKvGB * GiB) / tp;
    if (perGpu <= cap) return tp;
  }
  return null;
}

/* Throughput of one model replica occupying `tp` GPUs at a given batch size. */
function replicaThroughput({ model, precision, gpu, tp, batch, ctxTokens }) {
  const eff = tpEfficiency(tp, gpu.nvlink);
  const bw = gpu.bwGBs * 1e9 * tp * SERVING.bwEfficiency * eff;

  // Decode streams active weights (MoE reads only the routed experts) plus KV.
  const activeW = model.activeParams * precision.bytes * SERVING.weightOverhead;
  const kvSeq = kvBytesPerToken(model, precision) * ctxTokens;
  const stepBytes = activeW + batch * kvSeq;
  const stepTime = stepBytes / bw;

  const clusterTps = batch / stepTime;   // tokens/sec across the whole batch
  const perUserTps = 1 / stepTime;       // tokens/sec seen by one request
  return { clusterTps, perUserTps, tpotMs: stepTime * 1000 };
}

/* Prefill is compute bound: 2 FLOPs per active parameter per prompt token. */
function prefillTTFT({ model, precision, gpu, tp, promptTokens }) {
  const eff = tpEfficiency(tp, gpu.nvlink);
  const peak = (gpu.denseTFLOPS[precision.flopKey] || gpu.denseTFLOPS.bf16) * 1e12;
  const flops = peak * tp * SERVING.flopEfficiency * eff;
  const work = 2 * model.activeParams * promptTokens;
  return (work / flops) * 1000; // ms
}

/* Largest batch a replica can serve without breaching the TPOT target. */
function batchForTpot({ model, precision, gpu, tp, ctxTokens, tpotTargetMs }) {
  let lo = 1, hi = 4096, best = 0;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const { tpotMs } = replicaThroughput({ model, precision, gpu, tp, batch: mid, ctxTokens });
    if (tpotMs <= tpotTargetMs) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

/* Concurrent sequences a replica can hold, limited by leftover KV memory. */
function batchForMemory({ model, precision, gpu, tp, ctxTokens }) {
  const free = gpu.memGB * GiB * tp
    - weightBytes(model, precision)
    - SERVING.workspaceGB * GiB * tp;
  if (free <= 0) return 0;
  const kvSeq = kvBytesPerToken(model, precision) * ctxTokens;
  return Math.floor((free * SERVING.kvUtilisation) / kvSeq);
}

/* ---------- top-level sizing ---------- */
function sizeInference(input) {
  const model = input.customModel || MODELS[input.modelKey];
  const precision = PRECISIONS[input.precisionKey];
  const node = GPU_NODES[input.nodeKey];
  const gpu = GPUS[node.gpuKey];
  const ctxTokens = input.promptTokens + input.outputTokens;

  const notes = [];
  if (ctxTokens > model.ctxMax) {
    notes.push({ level: 'critical', text: `Requested context of ${ctxTokens.toLocaleString()} tokens exceeds ${model.label}'s ${model.ctxMax.toLocaleString()}-token maximum.` });
  }

  // Tensor-parallel width: enough GPUs to hold the weights plus a working KV pool.
  const minKvGB = 8;
  const tp = input.tpOverride || minTensorParallel({
    model, precision, gpu, gpusPerNode: node.gpuCount, minKvGB,
  });
  if (!tp) {
    return { error: `${model.label} at ${precision.label} cannot be held even across 64 nodes of ${gpu.short}.`, model, precision, node, gpu };
  }

  const memBatch = batchForMemory({ model, precision, gpu, tp, ctxTokens });
  const tpotBatch = batchForTpot({ model, precision, gpu, tp, ctxTokens, tpotTargetMs: input.tpotTargetMs });

  if (memBatch < 1) {
    return { error: `No KV memory left after weights: ${model.label} at ${precision.label} needs a wider tensor-parallel group or a smaller context.`, model, precision, node, gpu };
  }

  // The binding constraint is whichever allows fewer concurrent sequences.
  const batch = Math.max(1, Math.min(memBatch, tpotBatch || 1));
  const batchLimit = tpotBatch && tpotBatch < memBatch ? 'latency (TPOT)' : 'KV memory';

  const perf = replicaThroughput({ model, precision, gpu, tp, batch, ctxTokens });
  const ttftMs = prefillTTFT({ model, precision, gpu, tp, promptTokens: input.promptTokens });

  // Replicas needed to carry the requested concurrency, then rounded up to
  // whole nodes — GPUs are bought by the chassis, not individually.
  const replicas = Math.max(1, Math.ceil(input.concurrentRequests / batch));
  const gpusNeeded = replicas * tp;
  const nodes = Math.ceil(gpusNeeded / node.gpuCount);
  const gpusDeployed = nodes * node.gpuCount;

  // What the delivered hardware actually carries, which is usually more than
  // the request: a node holds gpuCount GPUs and every spare group of `tp` runs
  // another replica. Reporting only the requested figure would understate the
  // build and hide the rounding waste.
  const deployedReplicas = Math.floor(gpusDeployed / tp);
  const deployedConcurrency = deployedReplicas * batch;
  const clusterTps = deployedReplicas * perf.clusterTps;
  const requestedTps = replicas * perf.clusterTps;
  const reqPerHour = input.outputTokens > 0 ? (clusterTps * 3600) / input.outputTokens : 0;
  const gpuUtilPct = (gpusNeeded / gpusDeployed) * 100;

  if (gpusNeeded < gpusDeployed) {
    notes.push({
      level: 'info',
      text: `Rounding to whole nodes deploys ${gpusDeployed} GPUs where ${gpusNeeded} would serve the stated load. The spare capacity runs ${deployedReplicas - replicas} further replica(s), taking headroom to about ${deployedConcurrency.toLocaleString()} concurrent requests.`,
    });
  }

  if (ttftMs > input.ttftTargetMs) {
    notes.push({ level: 'warning', text: `Modelled TTFT of ${Math.round(ttftMs)} ms exceeds the ${input.ttftTargetMs} ms target. Widen tensor parallelism or shorten the prompt.` });
  }
  if (tp > node.gpuCount) {
    notes.push({ level: 'warning', text: `Tensor parallelism of ${tp} spans ${tp / node.gpuCount} nodes, so the model crosses the east-west fabric. Non-blocking 1:1 east-west is required, as specified in the reference architecture.` });
  }
  if (!gpu.nvlink && tp > 1) {
    notes.push({ level: 'warning', text: `${gpu.short} has no NVLink, so tensor parallelism pays a ${Math.round(SERVING.tpScalingLossPcie * 100)}% penalty per doubling over PCIe. Prefer one replica per GPU where the model fits.` });
  }
  if (model.moe) {
    notes.push({ level: 'info', text: `${model.label} is mixture-of-experts: all ${(model.params / 1e9).toFixed(0)}B parameters stay resident, but only ${(model.activeParams / 1e9).toFixed(1)}B activate per token, so throughput follows the active set.` });
  }
  if (batchLimit === 'latency (TPOT)' && tpotBatch < memBatch) {
    notes.push({ level: 'info', text: `Batch is capped at ${batch} by the ${input.tpotTargetMs} ms TPOT target; KV memory would allow ${memBatch}. Relaxing TPOT would raise throughput per GPU.` });
  }

  const perGpuMemGB = (weightBytes(model, precision) / tp + SERVING.workspaceGB * GiB
    + (batch * kvBytesPerToken(model, precision) * ctxTokens) / tp) / GiB;

  return {
    model, precision, node, gpu, ctxTokens,
    tp, batch, batchLimit, memBatch, tpotBatch, replicas, deployedReplicas,
    gpusNeeded, gpusDeployed, nodes, gpuUtilPct, deployedConcurrency,
    perUserTps: perf.perUserTps, tpotMs: perf.tpotMs, ttftMs,
    clusterTps, requestedTps, reqPerHour,
    perGpuMemGB, gpuMemGB: gpu.memGB,
    weightsGB: weightBytes(model, precision) / GiB,
    kvPerSeqGB: (kvBytesPerToken(model, precision) * ctxTokens) / GiB,
    notes,
  };
}

/* ---------- facility roll-up ----------
   Rack composition follows the reference architecture exactly: two GPU nodes
   per air-cooled rack, eight plus a 250 kW CDU per liquid-cooled rack, one
   fixed management rack, and a dedicated switch-fabric rack for regional and
   core profiles. */
function sizeFacility({ gpuNodes, nodeKey, coolingKey, profileKey, storageNodes }) {
  const node = GPU_NODES[nodeKey];
  const cooling = RACK.cooling[coolingKey];
  const profile = RA_PROFILES[profileKey];

  const perRack = cooling.gpuNodesPerRack;
  const computeRacks = Math.ceil(gpuNodes / perRack);

  // Fabric. A leaf splits its ports between servers below and spines above; the
  // split is what sets oversubscription. East-west runs 1:1 non-blocking so half
  // the ports face up, north-south runs 4:1 so only a fifth do.
  const leafPorts = FABRIC.sn5610.ports * FABRIC_RULES.breakout;
  const ewDown = Math.floor(leafPorts / (1 + 1 / FABRIC_RULES.eastWestOversub));   // 32 of 64
  const ewUp = leafPorts - ewDown;
  const ewPorts = gpuNodes * node.ewPortsPerNode;
  const ewLeaves = Math.max(2, Math.ceil(ewPorts / ewDown));
  // A leaf pair interconnects directly; spines only earn their place once the
  // fabric outgrows two leaves. Without this a single-node edge site would be
  // sized for a full two-tier Clos.
  const ewSpines = ewLeaves <= 2 ? 0 : Math.max(2, Math.ceil((ewLeaves * ewUp) / leafPorts));

  const nsDown = Math.floor(leafPorts / (1 + 1 / FABRIC_RULES.northSouthOversub)); // 51 of 64
  const nsUp = leafPorts - nsDown;
  const nsPorts = gpuNodes * 2; // dual-attached BlueField-3 north-south
  const nsLeaves = Math.max(2, Math.ceil(nsPorts / nsDown));
  const nsSpines = nsLeaves <= 2 ? 0 : Math.max(2, Math.ceil((nsLeaves * nsUp) / leafPorts));
  // Out-of-band is dual-homed in the RA, and carries BMC plus host management
  // for every node, switch and platform box — not just the GPU nodes.
  const oobPorts = (gpuNodes * 2 + ewLeaves + ewSpines + nsLeaves + nsSpines
    + RACK.mgmtRack.contents.length) * 2;
  const oobLeaves = Math.max(2, Math.ceil(oobPorts / FABRIC_RULES.oobLeafPorts));
  const oobSpines = oobLeaves > 2 ? 2 : 0;

  const switchU = (ewLeaves + ewSpines + nsLeaves + nsSpines) * FABRIC.sn5610.ru
    + oobLeaves * FABRIC.sn2201.ru + oobSpines * FABRIC.sn4600c.ru;
  // A dedicated fabric rack is only justified once the switching cannot sit in
  // the management and compute racks. Below that the leaves are top-of-rack.
  const fabricRacks = (profile.dedicatedFabricRack && switchU > 16)
    ? Math.max(1, Math.ceil(switchU / (RACK.totalU - 8))) : 0;

  // Storage racks are sized on chassis, not nodes: four nodes share a 2U box.
  const wekaChassis = Math.ceil((storageNodes || 0) / INFRA.wekapod.nodesPerChassis);
  const wekaU = wekaChassis * INFRA.wekapod.chassisRu;
  const storageRacks = profile.storage === 'wekapod' && storageNodes
    ? Math.max(1, Math.ceil(wekaU / (RACK.totalU - 8))) : 0;

  const mgmtRacks = 1;
  const totalRacks = computeRacks + fabricRacks + storageRacks + mgmtRacks;

  // Power.
  const gpuNodeW = gpuNodes * node.watts;
  const cduW = cooling.cdu ? computeRacks * INFRA.cdu.watts : 0;
  const tier2W = profile.storage === 'tier2' ? computeRacks * INFRA.tier2.watts : 0;
  const switchW = (ewLeaves + ewSpines + nsLeaves + nsSpines) * FABRIC.sn5610.watts
    + oobLeaves * FABRIC.sn2201.watts + oobSpines * FABRIC.sn4600c.watts;
  const storageW = (storageNodes || 0) * INFRA.wekapod.watts;
  const mgmtW = RACK.mgmtRack.watts;
  const totalW = gpuNodeW + cduW + tier2W + switchW + storageW + mgmtW;

  // Weight.
  const gpuNodeKg = gpuNodes * node.weightKg;
  const storageKg = (storageNodes || 0) * INFRA.wekapod.weightKg;
  const switchKg = (ewLeaves + ewSpines + nsLeaves + nsSpines) * FABRIC.sn5610.weightKg
    + oobLeaves * FABRIC.sn2201.weightKg + oobSpines * FABRIC.sn4600c.weightKg;
  const totalKg = gpuNodeKg + storageKg + switchKg + RACK.mgmtRack.weightKg
    + (cooling.cdu ? computeRacks * INFRA.cdu.weightKg : 0)
    + (profile.storage === 'tier2' ? computeRacks * INFRA.tier2.weightKg : 0);

  const perComputeRackW = perRack * node.watts
    + (cooling.cdu ? INFRA.cdu.watts : 0)
    + (profile.storage === 'tier2' ? INFRA.tier2.watts : 0);

  const rackU = perRack * node.ru + (cooling.cdu ? INFRA.cdu.ru : 0)
    + (profile.storage === 'tier2' ? INFRA.tier2.ru : 0);

  return {
    node, cooling, profile,
    computeRacks, fabricRacks, storageRacks, mgmtRacks, totalRacks,
    storage: { nodes: storageNodes || 0, chassis: wekaChassis, u: wekaU },
    fabric: { ewLeaves, ewSpines, nsLeaves, nsSpines, oobLeaves, oobSpines, switchU, ewPorts, nsPorts, oobPorts,
      ewOversub: FABRIC_RULES.eastWestOversub, nsOversub: FABRIC_RULES.northSouthOversub },
    power: { gpuNodeW, cduW, tier2W, switchW, storageW, mgmtW, totalW, perComputeRackW },
    weight: { totalKg },
    rackU, rackUsedPct: (rackU / RACK.totalU) * 100,
    coolingLoadBTU: totalW * 3.412,
  };
}

/* ---------- rack layout ----------
   Device placement mirrors the reference architecture elevations: the fixed
   management rack, GPU racks with their storage and CDU, a switch-fabric rack
   ordered OOB / north-south / east-west from the top down, and WEKApod chassis
   stacked in the storage rack. */
function buildRALayout(f, opts) {
  const node = f.node;
  const liquid = f.cooling.cdu;
  const nodeRu = liquid && node.ruLiquid ? node.ruLiquid : node.ru;
  const gpu = GPUS[node.gpuKey];
  const totalU = RACK.totalU;
  const racks = [];

  const dev = (uTop, ru, type, name, detail, extra) =>
    Object.assign({ uTop, ru, type, name, detail }, extra || {});

  // --- management rack, fixed across all three reference designs ---
  const m = [];
  m.push(dev(48, 1, 'panel', 'Patch panel', 'Fibre + copper'));
  m.push(dev(47, 1, 'panel', 'Converter', 'Media converter'));
  m.push(dev(46, 3, 'infra', 'OOB break-glass', 'RevPi + SITOP'));
  m.push(dev(42, 1, 'infra', 'Serial switch', INFRA.serial.model));
  m.push(dev(40, 1, 'infra', 'OOB firewall A', INFRA['oob-fw'].model));
  m.push(dev(38, 1, 'infra', 'OOB firewall B', INFRA['oob-fw'].model));
  m.push(dev(36, 1, 'infra', 'Platform router A', INFRA['platform-router'].model, { drives: 4 }));
  m.push(dev(34, 1, 'infra', 'Platform router B', INFRA['platform-router'].model, { drives: 4 }));
  m.push(dev(32, 1, 'infra', 'Platform server 1', INFRA['platform-server'].model, { drives: 4 }));
  m.push(dev(30, 1, 'infra', 'Platform server 2', INFRA['platform-server'].model, { drives: 4 }));
  m.push(dev(28, 1, 'infra', 'Platform server 3', INFRA['platform-server'].model, { drives: 4 }));
  m.push(dev(26, 2, 'infra', 'Tier 3 storage', INFRA.tier3.model, { drives: 4 }));
  m.push(dev(24, 1, 'switch', 'OOB leaf A', FABRIC.sn2201.label, { ports: 48, role: 'oob' }));
  m.push(dev(23, 1, 'switch', 'OOB leaf B', FABRIC.sn2201.label, { ports: 48, role: 'oob' }));
  m.push(dev(2, 1, 'infra', 'CPU compute node 1', INFRA['cpu-node'].model, { drives: 4 }));
  m.push(dev(1, 1, 'infra', 'CPU compute node 2', INFRA['cpu-node'].model, { drives: 4 }));
  racks.push({ name: 'Management rack', kind: 'mgmt', devices: m });

  // --- GPU compute racks ---
  const perRack = f.cooling.gpuNodesPerRack;
  let placed = 0;
  for (let r = 0; r < f.computeRacks; r++) {
    const d = [];
    const here = Math.min(perRack, opts.gpuNodes - placed);
    // Reserve the bottom of the rack for storage and, on DLC, the CDU.
    let bottom = 1;
    if (liquid) { d.push(dev(4, INFRA.cdu.ru, 'infra', 'CDU 250 kW', INFRA.cdu.label)); bottom = 5; }
    if (f.profile.storage === 'tier2') {
      d.push(dev(bottom + INFRA.tier2.ru - 1, INFRA.tier2.ru, 'infra', 'Tier 2 block storage', INFRA.tier2.model, { drives: 12 }));
      bottom += INFRA.tier2.ru;
    }
    // Stack GPU nodes downward from the top of the rack.
    let u = totalU;
    for (let n = 0; n < here; n++) {
      placed++;
      d.push(dev(u, nodeRu, node.label.startsWith('NVIDIA DGX') ? 'dgx' : 'gpu',
        `GPU node ${placed}`, `${node.gpuCount}x ${gpu.short}${liquid ? ' DLC' : ''}`,
        { gpuCount: node.gpuCount, gpuShort: gpu.short, ewPorts: node.ewPortsPerNode,
          ewGb: node.ewPortGb, nsPorts: 2, nsGb: 400, psuCount: node.psuCount || 4 }));
      u -= nodeRu;
    }
    racks.push({ name: `GPU compute rack ${r + 1}`, kind: 'gpu', devices: d });
  }

  // --- switch fabric rack(s) ---
  if (f.fabricRacks > 0) {
    const all = [];
    for (let i = 0; i < f.fabric.oobSpines; i++) all.push({ ru: 2, label: `OOB spine ${i + 1}`, m: FABRIC.sn4600c, role: 'oob' });
    for (let i = 0; i < f.fabric.oobLeaves; i++) all.push({ ru: 1, label: `OOB leaf ${i + 1}`, m: FABRIC.sn2201, role: 'oob' });
    for (let i = 0; i < f.fabric.nsSpines; i++) all.push({ ru: 2, label: `North-south spine ${i + 1}`, m: FABRIC.sn5610, role: 'ns' });
    for (let i = 0; i < f.fabric.nsLeaves; i++) all.push({ ru: 2, label: `North-south leaf ${i + 1}`, m: FABRIC.sn5610, role: 'ns' });
    for (let i = 0; i < f.fabric.ewSpines; i++) all.push({ ru: 2, label: `East-west spine ${i + 1}`, m: FABRIC.sn5610, role: 'ew' });
    for (let i = 0; i < f.fabric.ewLeaves; i++) all.push({ ru: 2, label: `East-west leaf ${i + 1}`, m: FABRIC.sn5610, role: 'ew' });

    let idx = 0;
    for (let r = 0; r < f.fabricRacks; r++) {
      const d = []; let u = totalU;
      // A blank unit between switches, as the elevations draw them.
      while (idx < all.length && u - all[idx].ru + 1 >= 1) {
        const sw = all[idx++];
        d.push(dev(u, sw.ru, 'switch', sw.label, sw.m.label, { ports: sw.m.ports, role: sw.role }));
        u -= sw.ru + 1;
      }
      racks.push({ name: f.fabricRacks > 1 ? `Switch fabric rack ${r + 1}` : 'Switch fabric rack', kind: 'fabric', devices: d });
    }
  }

  // --- storage rack(s) ---
  if (f.storageRacks > 0 && f.storage.chassis > 0) {
    let left = f.storage.chassis;
    for (let r = 0; r < f.storageRacks; r++) {
      const d = []; let u = totalU;
      while (left > 0 && u - INFRA.wekapod.chassisRu + 1 >= 1) {
        const n = Math.min(INFRA.wekapod.nodesPerChassis, f.storage.nodes - (f.storage.chassis - left) * INFRA.wekapod.nodesPerChassis);
        d.push(dev(u, INFRA.wekapod.chassisRu, 'wekapod',
          `WEKApod chassis ${f.storage.chassis - left + 1}`, `${n} nodes`, { nodes: n }));
        u -= INFRA.wekapod.chassisRu; left--;
      }
      racks.push({ name: f.storageRacks > 1 ? `Storage rack ${r + 1}` : 'POSIX/S3/AI storage rack', kind: 'storage', devices: d });
    }
  }

  return { racks, nodeRu };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sizeInference, sizeFacility, buildRALayout, kvBytesPerToken, weightBytes, replicaThroughput, minTensorParallel };
}
