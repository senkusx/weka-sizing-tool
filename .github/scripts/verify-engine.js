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
for (const f of ['catalog.js', 'sizing.js']) {
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

console.log(failures ? `\n${failures} check(s) failed\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);
