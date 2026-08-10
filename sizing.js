/* WEKA sizing engine — pure functions, no DOM.
   Capacity uses the net-capacity formula published in Lenovo Press LP1698, which
   matches WEKA's own planning documentation:

     Net = Raw x (FD - HotSpares)/FD x D/(D+P) x 0.9

   Verified against both LP1698 worked examples:
     6 srv x 10 x 3.20 TB, 4+2, 1 spare -> 96.0 TB   (doc says 96 TB)
    10 srv x 10 x 7.68 TB, 8+2, 1 spare -> 497.7 TB  (doc says 498 TB)
*/

const TB_TO_GIB = 1e12 / 2 ** 30; // decimal TB -> GiB

/* WEKA process layout for a backend server.
   docs.weka.io: 1 drive process per SSD up to 6 SSDs, then 1 per 2 SSDs beyond;
   2 compute processes per drive process. */
function processLayout(drivesPerNode, frontendProcs = 2) {
  const driveProcs =
    drivesPerNode <= 6 ? drivesPerNode : 6 + Math.ceil((drivesPerNode - 6) / 2);
  const computeProcs = driveProcs * 2;
  return {
    driveProcs,
    computeProcs,
    frontendProcs,
    wekaCores: driveProcs + computeProcs + frontendProcs,
  };
}

/* Per-server memory, following WEKA's published component table. Returns GiB. */
function memoryPerServer({ drivesPerNode, driveTB, frontendProcs, protocols, rdma, installedRamGB }) {
  const m = WEKA.mem;
  const L = processLayout(drivesPerNode, frontendProcs);
  const rawGiBPerServer = drivesPerNode * driveTB * TB_TO_GIB;
  const installedGiB = installedRamGB * (1e9 / 2 ** 30);

  const parts = {
    fixed: m.fixedGiB,
    frontend: m.perFrontendGiB * L.frontendProcs,
    compute: m.perComputeGiB * L.computeProcs,
    drive: m.perDriveGiB * L.driveProcs,
    ssdManagement: rawGiBPerServer / m.ssdMgmtDivisor,
    cores: L.wekaCores * m.perCoreGiB,
    os: Math.max(m.osFloorGiB, m.osFraction * installedGiB),
    protocols: protocols ? m.protocolsGiB : 0,
    rdma: rdma ? m.rdmaGiB : 0,
  };
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  return { parts, totalGiB: total, layout: L };
}

/* Per-node throughput ceiling — the binding resource among network, drives and CPU. */
function nodeThroughput({ drivesPerNode, drive, nic, nicCount, cores, frontendProcs, scheme }) {
  const p = WEKA.perf;
  const L = processLayout(drivesPerNode, frontendProcs);

  const wireGbps = nic.gb * nic.ports * nicCount;
  const network = (wireGbps / 8) * p.networkEfficiency;
  const drives = drivesPerNode * drive.gbps * p.driveEfficiency;
  const cpu = Math.min(L.wekaCores, Math.max(0, cores - 1)) * p.gbPerSecPerCore;

  const limits = [
    { id: 'network', label: 'Network', value: network },
    { id: 'drives', label: 'NVMe drives', value: drives },
    { id: 'cpu', label: 'CPU cores', value: cpu },
  ];
  const read = Math.min(network, drives, cpu);
  const bottleneck = limits.reduce((a, b) => (b.value < a.value ? b : a));
  const write = read * scheme.efficiency * p.writePenalty;

  const readIops = Math.min(
    L.wekaCores * p.iopsPerCore,
    drivesPerNode * p.iopsPerDriveCap
  );
  const writeIops = readIops * scheme.efficiency * p.writePenalty;

  return { read, write, readIops, writeIops, limits, bottleneck, wireGbps };
}

/* Net usable capacity in TB for a given node count. */
function netCapacityTB({ nodes, drivesPerNode, driveTB, hotSpares, scheme }) {
  const raw = nodes * drivesPerNode * driveTB;
  const failureDomains = nodes;
  if (failureDomains <= hotSpares) return 0;
  return (
    raw *
    ((failureDomains - hotSpares) / failureDomains) *
    scheme.efficiency *
    WEKA.fsOverhead
  );
}

/* Smallest node count meeting both the capacity and throughput targets, plus all
   hard minimums. Capacity is linear in (nodes - hotSpares), so it inverts directly. */
function solveNodeCount({ targetTB, targetReadGBps, drivesPerNode, driveTB, hotSpares, scheme, perNodeRead, server }) {
  const perNodeUsable = drivesPerNode * driveTB * scheme.efficiency * WEKA.fsOverhead;
  const forCapacity = targetTB > 0 ? Math.ceil(targetTB / perNodeUsable) + hotSpares : 0;
  const forThroughput = targetReadGBps > 0 ? Math.ceil(targetReadGBps / perNodeRead) : 0;

  const floors = [
    { n: server.minCluster, why: `${server.label} minimum cluster size` },
    { n: WEKA.minServersProduction, why: 'WEKA production minimum (6 backends)' },
    { n: scheme.stripe, why: `stripe width ${scheme.id} needs ≥ ${scheme.stripe} failure domains` },
    { n: forCapacity, why: 'usable capacity target' },
    { n: forThroughput, why: 'read throughput target' },
  ];
  const winner = floors.reduce((a, b) => (b.n > a.n ? b : a));
  return { nodes: Math.max(1, winner.n), driver: winner.why, forCapacity, forThroughput };
}

function licenseTier(netTB) {
  return WEKA.licenseTiers.find((t) => netTB <= t.maxTB).label;
}

/* Main entry point. `input` is the fully-resolved form state. */
function size(input) {
  const server = SERVERS[input.serverKey];
  const vendor = VENDORS[server.vendor];
  const drive = DRIVES[input.driveKey];
  const nic = NICS[input.nicKey];
  const cpu = server.cpuOptions.find((c) => c.id === input.cpuId) || server.cpuOptions[0];
  const scheme = PROTECTION_SCHEMES.find((s) => s.id === input.schemeId);
  const workload = WORKLOADS[input.workloadId];
  const drivesPerNode = input.drivesPerNode;
  const frontendProcs = workload.fePerNode;

  const perNode = nodeThroughput({
    drivesPerNode,
    drive,
    nic,
    nicCount: input.nicCount,
    cores: cpu.cores,
    frontendProcs,
    scheme,
  });

  const solved = solveNodeCount({
    targetTB: input.targetTB,
    targetReadGBps: input.targetReadGBps,
    drivesPerNode,
    driveTB: drive.tb,
    hotSpares: input.hotSpares,
    scheme,
    perNodeRead: perNode.read,
    server,
  });

  const nodes = input.manualNodes ? Math.max(1, input.manualNodes) : solved.nodes;

  const rawTB = nodes * drivesPerNode * drive.tb;
  const netTB = netCapacityTB({ nodes, drivesPerNode, driveTB: drive.tb, hotSpares: input.hotSpares, scheme });

  // Capacity waterfall: where the raw capacity goes.
  const afterSpare = rawTB * ((nodes - input.hotSpares) / nodes);
  const spareTB = rawTB - afterSpare;
  const afterParity = afterSpare * scheme.efficiency;
  const parityTB = afterSpare - afterParity;
  const overheadTB = afterParity - netTB;

  const mem = memoryPerServer({
    drivesPerNode,
    driveTB: drive.tb,
    frontendProcs,
    protocols: input.protocols,
    rdma: input.rdma,
    installedRamGB: input.ramGB,
  });

  const cluster = {
    read: perNode.read * nodes,
    write: perNode.write * nodes,
    readIops: perNode.readIops * nodes,
    writeIops: perNode.writeIops * nodes,
  };

  const ru = nodes * server.ru;
  const dataPorts = nodes * nic.ports * input.nicCount;
  const sw = SWITCHES[input.switchKey] || SWITCHES[vendor.switchKeys[0]];
  const switchCount = Math.max(2, 2 * Math.ceil(dataPorts / 2 / sw.ports));
  const powerW = nodes * server.typicalWatts + switchCount * 350;
  const racksNeeded = Math.max(1, Math.ceil((ru + switchCount * sw.ru) / 40));

  const installedGiB = input.ramGB * (1e9 / 2 ** 30);
  const totalRamGB = nodes * input.ramGB;
  const storageToRam = rawTB / (totalRamGB / 1000);

  const warnings = validate({
    input, server, drive, nic, cpu, scheme, nodes, mem, installedGiB,
    storageToRam, drivesPerNode, perNode, netTB, vendor,
  });

  const spec = specProjection({ input, nodes, workload, drive, cpu, perNode });

  return {
    server, vendor, drive, nic, cpu, scheme, workload, sw, spec,
    nodes, drivesPerNode, solved,
    capacity: {
      rawTB, netTB, spareTB, parityTB, overheadTB, afterSpare, afterParity,
      efficiencyPct: rawTB > 0 ? (netTB / rawTB) * 100 : 0,
      licenseTier: licenseTier(netTB),
    },
    perNode, cluster, mem,
    physical: { ru, racksNeeded, powerW, btuPerHr: powerW * 3.412, dataPorts, switchCount },
    network: { totalWireGbps: perNode.wireGbps * nodes, fabric: nic.fabric, rdma: nic.rdma },
    ratios: { storageToRam, totalRamGB },
    warnings,
  };
}

function validate(ctx) {
  const w = [];
  const { input, server, drive, nic, cpu, scheme, nodes, mem, installedGiB, storageToRam, drivesPerNode, perNode, netTB, vendor } = ctx;
  const add = (level, title, detail) => w.push({ level, title, detail });

  if (nodes < server.minCluster)
    add('critical', `Below ${server.label} minimum cluster size`,
      `${vendor.label} documents a ${server.minCluster}-server minimum; this design has ${nodes}.`);

  if (nodes < WEKA.minServersProduction)
    add('critical', 'Below WEKA production minimum',
      `WEKA requires at least ${WEKA.minServersToForm} servers to form a cluster and recommends ${WEKA.minServersProduction} for production. This design has ${nodes}.`);

  if (scheme.stripe > nodes)
    add('critical', 'Stripe width exceeds failure domain count',
      `${scheme.id} needs ${scheme.stripe} failure domains but the cluster has ${nodes}. WEKA requires stripe width ≤ failure domains.`);

  if (nodes >= 20 && scheme.stripe > nodes * 0.25)
    add('warning', 'Stripe width above 25% of cluster size',
      `WEKA advises stripe width ≤ 25% of cluster size on large clusters. ${scheme.id} is ${((scheme.stripe / nodes) * 100).toFixed(0)}% of ${nodes} nodes — consider a narrower stripe.`);

  if (nodes >= 100 && scheme.p < 4)
    add('warning', 'Consider +4 parity at this scale',
      `WEKA recommends N+4 protection for clusters of roughly 100+ backends. This design uses ${scheme.id}.`);

  if (drive.tb > WEKA.maxDriveTB * 1.05)
    add('critical', 'Drive exceeds WEKA maximum capacity',
      `WEKA supports SSDs up to ${WEKA.maxDriveTB} TB; ${drive.label} is ${drive.tb} TB.`);
  else if (drive.tb > WEKA.maxDriveTB)
    add('warning', 'Drive is at WEKA’s documented capacity ceiling',
      `WEKA documents a ${WEKA.maxDriveTB} TB maximum per SSD and this drive is marketed at ${drive.tb} TB. The gap is a decimal-versus-binary rounding difference, so it is normally fine — confirm the exact model is on WEKA’s qualified list.`);

  if (drivesPerNode < server.bays.min || drivesPerNode > server.bays.max)
    add('critical', 'Drive count outside chassis bay range',
      `${server.label} supports ${server.bays.min}–${server.bays.max} data drives per node; ${drivesPerNode} requested.`);

  if (mem.totalGiB > installedGiB)
    add('critical', 'Insufficient RAM per node',
      `WEKA needs about ${mem.totalGiB.toFixed(1)} GiB per server but only ${installedGiB.toFixed(1)} GiB is installed. Increase memory or reduce drives per node.`);
  else if (mem.totalGiB > installedGiB * 0.85)
    add('warning', 'Little RAM headroom',
      `WEKA needs about ${mem.totalGiB.toFixed(1)} GiB of the ${installedGiB.toFixed(1)} GiB installed (${((mem.totalGiB / installedGiB) * 100).toFixed(0)}%). Consider the next memory tier.`);

  if (mem.totalGiB > WEKA.ramWarnThresholdGiB)
    add('warning', 'Above WEKA’s self-service memory threshold',
      `Configurations needing more than ${WEKA.ramWarnThresholdGiB} GiB per server should be reviewed with WEKA’s Customer Success team.`);

  if (storageToRam > WEKA.maxStorageToRamRatio)
    add('critical', 'Storage-to-RAM ratio exceeded',
      `Total SSD capacity to total cluster RAM is ${Math.round(storageToRam)}:1; WEKA’s limit is ${WEKA.maxStorageToRamRatio}:1. Add RAM or reduce capacity per node.`);

  const coresNeeded = mem.layout.wekaCores + 1;
  if (coresNeeded > cpu.cores)
    add('critical', 'Not enough CPU cores',
      `This drive count needs ${mem.layout.wekaCores} WEKA cores plus 1 for the OS (${coresNeeded} total), but ${cpu.label} provides ${cpu.cores}.`);
  else if (coresNeeded > cpu.cores * 0.9)
    add('warning', 'CPU nearly fully committed',
      `${mem.layout.wekaCores} WEKA cores + 1 OS core of ${cpu.cores} available.`);

  if (mem.layout.wekaCores > WEKA.maxCoresPerContainer && mem.layout.wekaCores <= WEKA.maxCoresPerServer)
    add('info', 'Multiple containers required',
      `WEKA caps a container at ${WEKA.maxCoresPerContainer} physical cores, so these ${mem.layout.wekaCores} cores will be split across containers. This is normal and handled at install time.`);

  if (!nic.rdma)
    add('warning', 'No RDMA on the selected adapter',
      'Without RDMA, WEKA falls back to kernel UDP, giving lower throughput and higher latency. RDMA benefits reads ≥32 KB and writes ≥256 KB.');

  if (nic.gb < 100)
    add('warning', 'Low-bandwidth data network',
      `${nic.gb} GbE per port will bottleneck NVMe backends. WEKA reference designs use 100–400 Gb per node.`);

  if (input.nicCount < 2)
    add('info', 'No network redundancy',
      'WEKA recommends at least two interfaces of the same type per server so a single adapter or switch failure does not take the node offline.');

  if (input.nicCount > server.maxDataNics)
    add('warning', 'More data adapters than qualified',
      `WEKA uses at most ${server.maxDataNics} RDMA adapters per server for cluster traffic; additional adapters serve object tiering or client protocols.`);

  if (input.hotSpares === 0)
    add('warning', 'No hot spare capacity',
      'With zero hot spares a failed server cannot be fully rebuilt into spare capacity until it is replaced. One spare is the common default.');

  if (input.hotSpares >= nodes)
    add('critical', 'Hot spares exceed cluster size',
      `${input.hotSpares} hot spares in a ${nodes}-node cluster leaves no usable capacity.`);

  if (perNode.bottleneck.id === 'network' && perNode.limits.find((l) => l.id === 'drives').value > perNode.read * 1.5)
    add('info', 'Network-bound design',
      `Drives can deliver about ${perNode.limits.find((l) => l.id === 'drives').value.toFixed(1)} GB/s per node but the network caps it at ${perNode.read.toFixed(1)} GB/s. Faster NICs would unlock more performance from the same drives.`);

  if (perNode.bottleneck.id === 'cpu')
    add('info', 'CPU-bound design',
      `CPU cores cap this node at ${perNode.read.toFixed(1)} GB/s. A higher core count would raise per-node throughput.`);

  if (input.targetTB > 0 && netTB < input.targetTB * 0.999)
    add('warning', 'Below the usable capacity target',
      `This configuration delivers ${netTB.toFixed(1)} TB against a ${input.targetTB} TB target. Increase node count, drive size, or drives per node.`);

  if (nodes >= 32 && input.hotSpares < 2)
    add('info', 'Consider a second hot spare',
      'At 32+ nodes, two hot spares is common so a second failure during rebuild still has somewhere to go.');

  return w;
}

/* Project SPECstorage 2020 results onto the sized cluster.

   Deliberately NOT a fitted formula. Normalising the two audited bare-metal WEKA
   submissions per node shows the ratio between them swings from 0.90x (VDA) to
   2.50x (GENOMICS) depending on workload — two data points cannot support a
   transfer function, and fitting one would be false precision. Instead each
   reference is scaled linearly by backend node count and the spread between them
   is reported as a range, with the reference hardware shown so the user can judge
   which end their build sits nearer. */
function specProjection({ input, nodes, workload, drive, cpu, perNode }) {
  const specKey = workload.spec;
  const meta = SPEC_WORKLOADS[specKey];
  const subs = SPEC_SUBMISSIONS.filter((s) => s.workload === specKey);
  if (!subs.length) return null;

  const rows = subs.map((s) => {
    const per = {
      metric: s.metric / s.nodes,
      ops: s.opsPerSec / s.nodes,
      mbps: s.mbPerSec / s.nodes,
    };
    // How closely the reference node resembles the configured node.
    let match = 0;
    if (s.drivePcie === drive.pcie) match += 2;
    if (Math.abs(s.drives - input.drivesPerNode) <= 4) match += 1;
    if (Math.abs(s.netGbPerNode - perNode.wireGbps) / s.netGbPerNode <= 0.34) match += 1;
    if (Math.abs(s.cpuCores - cpu.cores) <= 16) match += 1;
    return {
      ref: s,
      perNode: per,
      projected: { metric: per.metric * nodes, ops: per.ops * nodes, mbps: per.mbps * nodes },
      match,
    };
  }).sort((a, b) => b.match - a.match);

  const metrics = rows.map((r) => r.projected.metric);
  const closest = rows[0];

  return {
    specKey,
    meta,
    rows,
    closest,
    range: { low: Math.min(...metrics), high: Math.max(...metrics) },
    // Per-node throughput the references actually sustained on this workload,
    // against the peak-sequential ceiling the model predicts for the built node.
    achievedPerNodeGBps: rows.map((r) => r.perNode.mbps / 1000),
    modelledPeakGBps: perNode.read,
  };
}

/* Compare every valid protection scheme at the current hardware and node count. */
function compareSchemes(input, nodes) {
  const drive = DRIVES[input.driveKey];
  return PROTECTION_SCHEMES.filter((s) => s.stripe <= nodes).map((s) => ({
    scheme: s,
    netTB: netCapacityTB({ nodes, drivesPerNode: input.drivesPerNode, driveTB: drive.tb, hotSpares: input.hotSpares, scheme: s }),
    usablePct: ((nodes - input.hotSpares) / nodes) * s.efficiency * WEKA.fsOverhead * 100,
  }));
}

/* Net capacity across a sweep of node counts, for the scaling chart. */
function scalingCurve(input, scheme, maxNodes) {
  const drive = DRIVES[input.driveKey];
  const pts = [];
  const step = Math.max(1, Math.round(maxNodes / 12));
  for (let n = Math.max(scheme.stripe, SERVERS[input.serverKey].minCluster); n <= maxNodes; n += step) {
    pts.push({
      nodes: n,
      netTB: netCapacityTB({ nodes: n, drivesPerNode: input.drivesPerNode, driveTB: drive.tb, hotSpares: input.hotSpares, scheme }),
    });
  }
  return pts;
}
