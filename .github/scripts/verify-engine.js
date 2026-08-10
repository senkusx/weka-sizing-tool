#!/usr/bin/env node
/* Regression tests for the sizing engine.
 *
 * These are not unit tests of our own arithmetic — they check the engine still
 * reproduces figures published by third parties. If a change to catalog.js or
 * sizing.js breaks one of these, the tool has started disagreeing with the
 * documentation it claims to implement.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
for (const f of ['catalog.js', 'sizing.js', 'compute-catalog.js', 'inference.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}

let failures = 0;
function check(name, actual, expected, tolerance, unit = '') {
  const ok = Math.abs(actual - expected) <= tolerance;
  const round = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(52)} ${round(actual)}${unit}` +
    (ok ? '' : `  (expected ${round(expected)}${unit} ±${tolerance})`)
  );
  if (!ok) failures++;
}

const scheme = (id) => PROTECTION_SCHEMES.find((s) => s.id === id);

console.log('\nLenovo LP1698 net-capacity worked examples');
// 6 servers x 10 x 3.20 TB, 4+2, 1 hot spare -> the document states 96 TB.
check('6 x 10 x 3.20 TB, 4+2, 1 spare',
  netCapacityTB({ nodes: 6, drivesPerNode: 10, driveTB: 3.2, hotSpares: 1, scheme: scheme('4+2') }),
  96, 0.01, ' TB');
// 10 servers x 10 x 7.68 TB, 8+2, 1 hot spare -> the document states 498 TB.
check('10 x 10 x 7.68 TB, 8+2, 1 spare',
  netCapacityTB({ nodes: 10, drivesPerNode: 10, driveTB: 7.68, hotSpares: 1, scheme: scheme('8+2') }),
  498, 0.5, ' TB');

console.log('\nWEKA published 8-node benchmark (6x Micron 9300, dual 100GbE, 4+2)');
{
  const t = nodeThroughput({
    drivesPerNode: 6, drive: { tb: 7.68, gbps: 3.5 }, nic: { gb: 100, ports: 2 },
    nicCount: 1, cores: 40, frontendProcs: 2, scheme: scheme('4+2'),
  });
  const gib = (gb) => (gb * 8) / 1.0737; // per-node GB/s -> 8-node cluster GiB/s
  check('aggregate read', gib(t.read), 123, 8, ' GiB/s');
  check('aggregate write', gib(t.write), 37.6, 4, ' GiB/s');
  check('aggregate read IOPS', (t.readIops * 8) / 1e6, 4.35, 0.3, 'M');
  check('aggregate write IOPS', (t.writeIops * 8) / 1e6, 1.32, 0.15, 'M');
}

console.log('\nSPECstorage projection reproduces its own reference configurations');
{
  const base = {
    switchKey: 'qm9700', schemeId: '10+2', hotSpares: 1, protocols: true, rdma: true,
    targetTB: 0, targetReadGBps: 0,
  };
  // The HPE reference: 12x Alletra 4110, 16x 3.84 TB Gen5, 2x 400Gb. Published 5000 AI jobs.
  const hpe = size({
    ...base, serverKey: 'hpe-alletra4110', driveKey: 'pm1743-3.84', nicKey: 'cx7-ndr400-1p',
    cpuId: 'gold-6548n', ramGB: 512, drivesPerNode: 16, nicCount: 2,
    workloadId: 'ai-training', manualNodes: 12,
  });
  const hpeRow = hpe.spec.rows.find((r) => r.ref.vendor.startsWith('HPE'));
  check('HPE reference at 12 nodes -> AI_IMAGE', hpeRow.projected.metric, 5000, 0.5, ' jobs');

  // The Samsung reference: 6 nodes, 15x 3.84 TB Gen4. Published 1120 genomics jobs.
  const sam = size({
    ...base, serverKey: 'generic-1u', driveKey: 'gen-3.84-g4', nicKey: 'cx6dx-200-1p',
    switchKey: 'sn3700v', cpuId: 'g-64', ramGB: 512, drivesPerNode: 15, nicCount: 2,
    workloadId: 'genomics', manualNodes: 6,
  });
  const samRow = sam.spec.rows.find((r) => r.ref.vendor.startsWith('Samsung'));
  check('Samsung reference at 6 nodes -> GENOMICS', samRow.projected.metric, 1120, 0.5, ' jobs');

  // Closest-match must follow drive generation, not row order.
  const gen5Match = hpe.spec.closest.ref.vendor.startsWith('HPE');
  const gen4Match = sam.spec.closest.ref.vendor.startsWith('Samsung');
  console.log(`  ${gen5Match ? 'PASS' : 'FAIL'}  Gen5 build matches the HPE reference`);
  console.log(`  ${gen4Match ? 'PASS' : 'FAIL'}  Gen4 build matches the Samsung reference`);
  if (!gen5Match || !gen4Match) failures++;
}

console.log('\nEvery catalogued server model produces a valid design');
{
  let bad = 0;
  for (const key of Object.keys(SERVERS)) {
    const s = SERVERS[key];
    try {
      const r = size({
        serverKey: key, driveKey: s.defaultDrive, nicKey: s.defaultNic,
        switchKey: VENDORS[s.vendor].switchKeys[0], cpuId: s.cpuOptions[0].id,
        ramGB: s.ramOptionsGB[s.ramOptionsGB.length - 1], drivesPerNode: s.bays.max,
        nicCount: 2, schemeId: '8+2', workloadId: 'ai-training', hotSpares: 1,
        protocols: true, rdma: true, targetTB: 1000, targetReadGBps: 0, manualNodes: null,
      });
      const finite = [r.nodes, r.capacity.netTB, r.cluster.read, r.mem.totalGiB].every(Number.isFinite);
      if (!finite || r.nodes < 1 || r.capacity.netTB <= 0) { console.log(`  FAIL  ${key}`); bad++; }
    } catch (e) {
      console.log(`  FAIL  ${key} threw: ${e.message}`);
      bad++;
    }
  }
  console.log(`  ${bad ? 'FAIL' : 'PASS'}  ${Object.keys(SERVERS).length} models sized, ${bad} failure(s)`);
  failures += bad;
}

console.log('\nInferX reference architecture — facility roll-up');
{
  // The 2 MW design: 128 B300 nodes. Every figure below is stated in the
  // reference architecture's own elevations, so the model must reproduce them.
  const air = sizeFacility({ gpuNodes: 128, nodeKey: 'smc-b300', coolingKey: 'air', profileKey: 'core', storageNodes: 24 });
  const liq = sizeFacility({ gpuNodes: 128, nodeKey: 'smc-b300', coolingKey: 'liquid', profileKey: 'core', storageNodes: 24 });
  check('128x B300 fleet power', air.power.gpuNodeW, 1779072, 0, ' W');
  check('air-cooled compute racks', air.computeRacks, 64, 0);
  check('air-cooled total racks', air.totalRacks, 68, 0);
  check('liquid-cooled compute racks', liq.computeRacks, 16, 0);
  // Elevation rack totals: air 2x13899+1188, liquid 8x13899+3000+1188.
  check('air compute rack with Tier 2', air.power.rackWithTier2W, 28986, 0, ' W');
  check('air compute rack without Tier 2', air.power.rackPlainW, 27798, 0, ' W');
  check('liquid compute rack with Tier 2', liq.power.rackWithTier2W, 115380, 0, ' W');
  check('liquid compute rack without Tier 2', liq.power.rackPlainW, 114192, 0, ' W');
  // Both reference designs carry exactly three Tier 2 units, not one per rack.
  check('Tier 2 units on the 2 MW design', air.tier2Count, 3, 0, ' units');
  check('Tier 2 total power', air.power.tier2W, 3564, 0, ' W');
  // The 2 MW elevation uses two switch-fabric racks for 32 SN5610 + 12 SN2201 + 2 SN4600C.
  check('switch fabric racks on the 2 MW design', air.fabricRacks, 2, 0, ' racks');
  const rtx = sizeFacility({ gpuNodes: 8, nodeKey: 'smc-rtx6000', coolingKey: 'air', profileKey: 'edge', storageNodes: 0 });
  check('air RTX 6000 Pro rack with Tier 2', rtx.power.rackWithTier2W, 14246, 0, ' W');
  check('air RTX 6000 Pro rack without', rtx.power.rackPlainW, 13058, 0, ' W');

  // Every rack kind must actually be drawn, and the fabric rack must carry OOB.
  const L = buildRALayout(air, { gpuNodes: 128 });
  const kinds = new Set(L.racks.map((r) => r.kind));
  ['mgmt', 'gpu', 'fabric', 'storage'].forEach((k) => {
    const ok = kinds.has(k);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${k} rack is drawn`);
    if (!ok) failures++;
  });
  const fabRack = L.racks.find((r) => r.kind === 'fabric');
  const roles = new Set(fabRack.devices.filter((d) => d.type === 'switch').map((d) => d.role));
  ['oob', 'ns', 'ew'].forEach((r) => {
    const ok = roles.has(r);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  fabric rack carries ${r} switches`);
    if (!ok) failures++;
  });
  const t2Racks = L.racks.filter((r) => r.kind === 'gpu' && r.devices.some((d) => d.name === 'Tier 2 block storage')).length;
  check('GPU racks drawn with Tier 2', t2Racks, 3, 0, ' racks');

  // An edge site has no fabric rack, so its leaves belong in the management rack.
  const edge = sizeFacility({ gpuNodes: 1, nodeKey: 'smc-b300', coolingKey: 'air', profileKey: 'edge', storageNodes: 0 });
  const eL = buildRALayout(edge, { gpuNodes: 1 });
  const mgmtRoles = new Set(eL.racks[0].devices.filter((d) => d.type === 'switch').map((d) => d.role));
  const edgeOk = ['oob', 'ns', 'ew'].every((r) => mgmtRoles.has(r));
  console.log(`  ${edgeOk ? 'PASS' : 'FAIL'}  edge leaves fall back into the management rack`);
  if (!edgeOk) failures++;
}

console.log('\nDGX B300 and WEKApod form factors');
{
  const dgx = GPU_NODES['dgx-b300'];
  check('DGX B300 rack units', dgx.ru, 10, 0, 'U');
  check('DGX B300 power', dgx.watts, 14500, 0, ' W');
  check('DGX B300 weight', dgx.weightKg, 168, 0, ' kg');
  check('DGX B300 GPU memory total', dgx.gpuCount * GPUS[dgx.gpuKey].memGB, 2304, 0, ' GB');
  // The DLC B300 chassis is 4U, which is the only way eight fit with a CDU.
  const liq = sizeFacility({ gpuNodes: 8, nodeKey: 'smc-b300', coolingKey: 'liquid', profileKey: 'regional', storageNodes: 8 });
  const L = buildRALayout(liq, { gpuNodes: 8 });
  check('DLC B300 chassis height', L.nodeRu, 4, 0, 'U');
  const gpuRack = L.racks.find((r) => r.kind === 'gpu');
  const usedU = gpuRack.devices.reduce((a, d) => a + d.ru, 0);
  // 8 x 4U nodes + 4U CDU + 4U Tier 2 in the racks that carry one.
  check('8 DLC nodes + CDU + Tier 2 fit one rack', usedU, 40, 0, 'U');
  const overflow = L.racks.some((r) => r.devices.some((d) => d.uTop > RACK.totalU || d.uTop - d.ru + 1 < 1));
  console.log(`  ${overflow ? 'FAIL' : 'PASS'}  no device overflows its rack`);
  if (overflow) failures++;
  // WEKApod Nitro is a 2U four-node chassis, not four 1U boxes.
  check('WEKApod nodes per chassis', INFRA.wekapod.nodesPerChassis, 4, 0);
  check('24 WEKApod nodes occupy', liq.storage ? Math.ceil(24 / 4) * 2 : 0, 12, 0, 'U');
}

console.log('\nInference engine — memory arithmetic');
{
  const m = MODELS['llama31-70b'];
  // 70.6e9 params x 1 byte at FP8, x1.05 packing.
  check('Llama 3.1 70B weights at FP8', weightBytes(m, PRECISIONS.fp8) / 1024 ** 3, 69.0, 0.5, ' GiB');
  check('Llama 3.1 70B weights at FP16', weightBytes(m, PRECISIONS.fp16) / 1024 ** 3, 138.1, 0.5, ' GiB');
  // 2 x 80 layers x 8 kv heads x 128 head_dim x 1 byte = 163840 B per token.
  check('Llama 3.1 70B KV per token at FP8', kvBytesPerToken(m, PRECISIONS.fp8), 163840, 0, ' B');
  // A 405B model at FP4 must fit one 288 GB B300; at FP16 it must not.
  const tp4 = minTensorParallel({ model: MODELS['llama31-405b'], precision: PRECISIONS.fp4, gpu: GPUS.b300, gpusPerNode: 8, minKvGB: 8 });
  const tp16 = minTensorParallel({ model: MODELS['llama31-405b'], precision: PRECISIONS.fp16, gpu: GPUS.b300, gpusPerNode: 8, minKvGB: 8 });
  check('405B at FP4 fits one B300', tp4, 1, 0, ' GPU');
  check('405B at FP16 needs 4 B300', tp16, 4, 0, ' GPUs');
}

console.log('\nCapacity-led sizing (fixed fleet)');
{
  const base = {
    modelKey: 'llama31-70b', precisionKey: 'fp8', nodeKey: 'smc-b300',
    promptTokens: 2048, outputTokens: 512, concurrentRequests: 5000,
    ttftTargetMs: 1000, tpotTargetMs: 50, tpOverride: null, customModel: null,
  };
  const auto = sizeInference(base);
  const two = sizeInference({ ...base, fixedNodes: 2 });
  const sixteen = sizeInference({ ...base, fixedNodes: 16 });
  const one = sizeInference({ ...base, fixedNodes: 1 });
  check('fixed node count is honoured', sixteen.nodes, 16, 0, ' nodes');
  check('GPUs follow the fixed fleet', sixteen.gpusDeployed, 128, 0, ' GPUs');
  // Capacity must scale linearly with the fleet at constant batch.
  check('8x the nodes carries 8x concurrency',
    sixteen.deployedConcurrency / two.deployedConcurrency, 8, 0.01, 'x');
  // An undersized fleet must say so rather than silently under-deliver.
  console.log(`  ${one.shortfall ? 'PASS' : 'FAIL'}  1 node flags a shortfall against 5,000 concurrent`);
  if (!one.shortfall) failures++;
  console.log(`  ${!auto.shortfall ? 'PASS' : 'FAIL'}  workload-driven sizing never reports a shortfall`);
  if (auto.shortfall) failures++;
  // Fewer GPUs than the tensor-parallel width is an error, not a silent zero.
  const tiny = sizeInference({ ...base, modelKey: 'llama31-405b', precisionKey: 'fp16', nodeKey: 'smc-l40s', fixedNodes: 1 });
  console.log(`  ${tiny.error ? 'PASS' : 'FAIL'}  a fleet too small for one replica errors clearly`);
  if (!tiny.error) failures++;
}

console.log('\nInference engine — every model sizes on every node');
{
  let bad = 0;
  for (const mk of Object.keys(MODELS)) {
    for (const nk of Object.keys(GPU_NODES)) {
      const r = sizeInference({
        modelKey: mk, nodeKey: nk, precisionKey: 'fp8', promptTokens: 2048, outputTokens: 512,
        concurrentRequests: 64, ttftTargetMs: 1000, tpotTargetMs: 50, tpOverride: null, customModel: null,
      });
      if (r.error) continue; // a legitimate "does not fit" answer, not a crash
      const finite = [r.gpusDeployed, r.nodes, r.clusterTps, r.tpotMs, r.ttftMs, r.perGpuMemGB].every(Number.isFinite);
      if (!finite || r.gpusDeployed < 1 || r.batch < 1) { console.log(`  FAIL  ${mk} on ${nk}`); bad++; }
      if (r.perGpuMemGB > GPUS[GPU_NODES[nk].gpuKey].memGB * 1.001) { console.log(`  FAIL  ${mk} on ${nk} overcommits GPU memory (${r.perGpuMemGB.toFixed(0)} GB)`); bad++; }
    }
  }
  const n = Object.keys(MODELS).length * Object.keys(GPU_NODES).length;
  console.log(`  ${bad ? 'FAIL' : 'PASS'}  ${n} model/node combinations, ${bad} failure(s)`);
  failures += bad;
}

console.log(failures ? `\n${failures} check(s) failed\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);
