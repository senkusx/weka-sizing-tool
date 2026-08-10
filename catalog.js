/* WEKA sizing — hardware catalog and WEKA platform constants.
   Sources are cited per-record in `src` fields and surfaced in the app's Sources panel. */

const WEKA = {
  // Cluster / stripe constraints — docs.weka.io cluster-capacity-and-redundancy-management
  stripeMin: 5,
  stripeMax: 20,
  dataMin: 3,
  dataMax: 16,
  parityMin: 2,
  parityMax: 4,
  minServersToForm: 5,
  minServersProduction: 6,

  // Capacity — Lenovo LP1698 published net-capacity formula (matches WEKA planning docs)
  fsOverhead: 0.9,

  // Drive / ratio limits — docs.weka.io prerequisites-and-compatibility
  maxDriveTB: 30,
  maxDriveCapacityRatio: 8, // smallest : largest SSD in cluster
  maxStorageToRamRatio: 8000, // total SSD capacity : total cluster RAM
  bootDrives: { count: 2, capacityGB: 960, note: '≥1 DWPD, ≥1 GB/s write' },

  // Per-server hard limits
  maxCoresPerServer: 512,
  maxCoresPerContainer: 19,
  ramWarnThresholdGiB: 357.6, // above this WEKA asks you to engage their CS team

  // Per-server memory model — docs.weka.io planning-a-weka-system-installation
  mem: {
    fixedGiB: 2.61,
    perFrontendGiB: 2.05,
    perComputeGiB: 3.63,
    perDriveGiB: 1.86,
    ssdMgmtDivisor: 2000, // (raw SSD GiB per server) / 2000
    perCoreGiB: 2.79,
    osFloorGiB: 7.45,
    osFraction: 0.02,
    protocolsGiB: 14.9, // NFS / SMB / S3
    rdmaGiB: 1.86,
  },

  // Throughput/IOPS model coefficients. Calibrated against WEKA's published 8-node
  // SuperMicro benchmark (6x Micron 9300 NVMe, dual 100GbE, 4+2):
  // published 123 GiB/s read, 37.6 GiB/s write, 4.35M read IOPS, 1.32M write IOPS.
  perf: {
    networkEfficiency: 0.8, // usable fraction of wire rate
    driveEfficiency: 0.8, // usable fraction of aggregate drive rate
    gbPerSecPerCore: 1.6, // WEKA core throughput ceiling
    iopsPerCore: 27000,
    iopsPerDriveCap: 250000,
    writePenalty: 0.45, // applied on top of the D/(D+P) parity cost
  },

  // Licensing tiers — WEKA subscription is per net TB/year (Lenovo LP1698)
  licenseTiers: [
    { maxTB: 1000, label: 'Tier 1 — under 1 PB' },
    { maxTB: 2500, label: 'Tier 2 — 1 PB to 2.5 PB' },
    { maxTB: Infinity, label: 'Tier 3 — over 2.5 PB' },
  ],
};

/* Protection schemes. WEKA allows any D+P where D=3..16, P=2..4, D>P, 5<=D+P<=20.
   These are the combinations that appear in WEKA / partner documentation. */
const PROTECTION_SCHEMES = [
  { d: 3, p: 2 }, { d: 4, p: 2 }, { d: 5, p: 2 }, { d: 6, p: 2 },
  { d: 8, p: 2 }, { d: 10, p: 2 }, { d: 12, p: 2 }, { d: 16, p: 2 },
  { d: 5, p: 3 }, { d: 6, p: 3 }, { d: 8, p: 3 }, { d: 12, p: 3 }, { d: 16, p: 3 },
  { d: 5, p: 4 }, { d: 8, p: 4 }, { d: 12, p: 4 }, { d: 16, p: 4 },
].map((s) => ({
  ...s,
  id: `${s.d}+${s.p}`,
  stripe: s.d + s.p,
  efficiency: s.d / (s.d + s.p),
  driveFailures: s.p,
  // docs.weka.io: parity level sets simultaneous drive failures tolerated, but every
  // level tolerates 2 simultaneous *server* failures.
  serverFailures: 2,
}));

/* Drive catalog. tb = decimal TB as marketed. gbps = sustained sequential read per drive. */
const DRIVES = {
  // --- Lenovo qualified (LP1698) ---
  'p5620-3.2': { label: 'Intel P5620 3.2 TB (Mixed Use)', tb: 3.2, pcie: 4, gbps: 6.6, dwpd: 3 },
  'p5620-6.4': { label: 'Intel P5620 6.4 TB (Mixed Use)', tb: 6.4, pcie: 4, gbps: 6.8, dwpd: 3 },
  'p5620-12.8': { label: 'Intel P5620 12.8 TB (Mixed Use)', tb: 12.8, pcie: 4, gbps: 6.8, dwpd: 3 },
  'p5520-3.84': { label: 'Intel P5520 3.84 TB (Read Intensive)', tb: 3.84, pcie: 4, gbps: 6.6, dwpd: 1 },
  'p5520-7.68': { label: 'Intel P5520 7.68 TB (Read Intensive)', tb: 7.68, pcie: 4, gbps: 7.1, dwpd: 1 },
  'p5520-15.36': { label: 'Intel P5520 15.36 TB (Read Intensive)', tb: 15.36, pcie: 4, gbps: 7.1, dwpd: 1 },
  'pm1733-3.84': { label: 'Samsung PM1733 3.84 TB', tb: 3.84, pcie: 4, gbps: 6.4, dwpd: 1 },
  'pm1733-7.68': { label: 'Samsung PM1733 7.68 TB', tb: 7.68, pcie: 4, gbps: 7.0, dwpd: 1 },
  'pm1733-15.36': { label: 'Samsung PM1733 15.36 TB', tb: 15.36, pcie: 4, gbps: 7.0, dwpd: 1 },

  // --- HPE qualified ---
  'pm1743-3.84': { label: 'Samsung PM1743 3.84 TB (E3.S, Gen5)', tb: 3.84, pcie: 5, gbps: 13.0, dwpd: 1 },
  'pm1743-7.68': { label: 'Samsung PM1743 7.68 TB (E3.S, Gen5)', tb: 7.68, pcie: 5, gbps: 14.0, dwpd: 1 },
  'pm1743-15.36': { label: 'Samsung PM1743 15.36 TB (E3.S, Gen5)', tb: 15.36, pcie: 5, gbps: 14.0, dwpd: 1 },
  'hpe-3.84-g4': { label: 'HPE 3.84 TB NVMe (Gen4)', tb: 3.84, pcie: 4, gbps: 6.6, dwpd: 1 },
  'hpe-7.68-g4': { label: 'HPE 7.68 TB NVMe (Gen4)', tb: 7.68, pcie: 4, gbps: 7.0, dwpd: 1 },
  'hpe-15.36-g4': { label: 'HPE 15.36 TB NVMe (Gen4)', tb: 15.36, pcie: 4, gbps: 7.0, dwpd: 1 },

  // --- Generic ---
  'gen-1.92-g4': { label: 'Generic 1.92 TB NVMe (Gen4)', tb: 1.92, pcie: 4, gbps: 6.0, dwpd: 1 },
  'gen-3.84-g4': { label: 'Generic 3.84 TB NVMe (Gen4)', tb: 3.84, pcie: 4, gbps: 6.6, dwpd: 1 },
  'gen-7.68-g4': { label: 'Generic 7.68 TB NVMe (Gen4)', tb: 7.68, pcie: 4, gbps: 7.0, dwpd: 1 },
  'gen-15.36-g4': { label: 'Generic 15.36 TB NVMe (Gen4)', tb: 15.36, pcie: 4, gbps: 7.0, dwpd: 1 },
  'gen-30.72-g4': { label: 'Generic 30.72 TB NVMe (Gen4)', tb: 30.72, pcie: 4, gbps: 7.0, dwpd: 1 },
  'gen-7.68-g5': { label: 'Generic 7.68 TB NVMe (Gen5)', tb: 7.68, pcie: 5, gbps: 14.0, dwpd: 1 },
  'gen-15.36-g5': { label: 'Generic 15.36 TB NVMe (Gen5)', tb: 15.36, pcie: 5, gbps: 14.0, dwpd: 1 },
  'gen-30.72-g5': { label: 'Generic 30.72 TB NVMe (Gen5)', tb: 30.72, pcie: 5, gbps: 14.0, dwpd: 1 },
};

/* NIC catalog. ports = physical ports per adapter, gb = per-port line rate. */
const NICS = {
  'cx6-hdr200-1p': { label: 'ConnectX-6 HDR / 200GbE QSFP56, 1-port', ports: 1, gb: 200, rdma: true, fabric: 'Both' },
  'cx6-hdr100-2p': { label: 'ConnectX-6 HDR100 / 100GbE QSFP56, 2-port', ports: 2, gb: 100, rdma: true, fabric: 'Both' },
  'cx6dx-200-1p': { label: 'ConnectX-6 Dx 200GbE QSFP56, 1-port', ports: 1, gb: 200, rdma: true, fabric: 'Ethernet' },
  'cx6dx-100-2p': { label: 'ConnectX-6 Dx 100GbE QSFP56, 2-port', ports: 2, gb: 100, rdma: true, fabric: 'Ethernet' },
  'cx7-ndr400-1p': { label: 'ConnectX-7 NDR 400Gb IB OSFP, 1-port', ports: 1, gb: 400, rdma: true, fabric: 'InfiniBand' },
  'cx7-200-2p': { label: 'ConnectX-7 200GbE QSFP112, 2-port', ports: 2, gb: 200, rdma: true, fabric: 'Ethernet' },
  'cx7-400-1p-eth': { label: 'ConnectX-7 400GbE OSFP, 1-port', ports: 1, gb: 400, rdma: true, fabric: 'Ethernet' },
  'cx5-100-2p': { label: 'ConnectX-5 100GbE QSFP28, 2-port', ports: 2, gb: 100, rdma: true, fabric: 'Both' },
  'eth-25-2p': { label: 'Generic 25GbE, 2-port (no RDMA)', ports: 2, gb: 25, rdma: false, fabric: 'Ethernet' },
};

/* Switch catalog for fabric sizing. */
const SWITCHES = {
  'qm8700': { label: 'NVIDIA QM8700 HDR InfiniBand', ports: 40, gb: 200, fabric: 'InfiniBand', ru: 1 },
  'qm9700': { label: 'NVIDIA QM9700 NDR InfiniBand', ports: 64, gb: 400, fabric: 'InfiniBand', ru: 1 },
  'sn3700v': { label: 'NVIDIA SN3700V 200GbE', ports: 32, gb: 200, fabric: 'Ethernet', ru: 1 },
  'sn3700c': { label: 'NVIDIA SN3700C 100GbE', ports: 32, gb: 100, fabric: 'Ethernet', ru: 1 },
  'sn5600': { label: 'NVIDIA SN5600 800GbE', ports: 64, gb: 800, fabric: 'Ethernet', ru: 2 },
};

/* Server models. Each references the drives/NICs its vendor documentation qualifies. */
const SERVERS = {
  'lenovo-sr630v2': {
    vendor: 'lenovo',
    label: 'ThinkSystem SR630 V2',
    sublabel: 'Lenovo EveryScale WEKA Storage Node — CTO 7Z71CTO6WW',
    ru: 1,
    sockets: 2,
    cpuOptions: [
      { id: 'gold-6326', label: '2x Xeon Gold 6326 16C 2.9GHz 185W', cores: 32, watts: 370 },
    ],
    ramOptionsGB: [256, 512],
    bays: { min: 4, max: 10 },
    driveKeys: ['p5620-3.2', 'p5620-6.4', 'p5620-12.8', 'p5520-3.84', 'p5520-7.68', 'p5520-15.36', 'pm1733-3.84', 'pm1733-7.68', 'pm1733-15.36'],
    nicKeys: ['cx6-hdr200-1p', 'cx6-hdr100-2p', 'cx6dx-200-1p', 'cx6dx-100-2p'],
    maxDataNics: 2,
    defaultDrive: 'p5520-7.68',
    defaultNic: 'cx6-hdr200-1p',
    psu: '2x 1100W Platinum hot-swap',
    typicalWatts: 700,
    minCluster: 6,
    src: 'Lenovo Press LP1698',
  },
  'lenovo-sr630v3': {
    vendor: 'lenovo',
    label: 'ThinkSystem SR630 V3',
    sublabel: 'WEKA Ready Node — CTO 7D73CTO8WW (specs generalised)',
    ru: 1,
    sockets: 2,
    cpuOptions: [
      { id: 'gold-6442y', label: '2x Xeon Gold 6442Y 24C', cores: 48, watts: 450 },
      { id: 'plat-8462y', label: '2x Xeon Platinum 8462Y+ 32C', cores: 64, watts: 600 },
    ],
    ramOptionsGB: [256, 512, 768, 1024],
    bays: { min: 4, max: 10 },
    driveKeys: ['p5520-3.84', 'p5520-7.68', 'p5520-15.36', 'gen-7.68-g5', 'gen-15.36-g5', 'gen-30.72-g5'],
    nicKeys: ['cx6-hdr200-1p', 'cx6dx-200-1p', 'cx7-ndr400-1p', 'cx7-200-2p'],
    maxDataNics: 2,
    defaultDrive: 'p5520-7.68',
    defaultNic: 'cx7-200-2p',
    psu: '2x 1100W Titanium hot-swap',
    typicalWatts: 800,
    minCluster: 6,
    src: 'Lenovo WEKA Ready Node family (LP1691)',
  },
  'lenovo-sr655v3': {
    vendor: 'lenovo',
    label: 'ThinkSystem SR655 V3',
    sublabel: 'Single-socket AMD WEKA Ready Node — CTO 7D9ECTO8WW',
    ru: 1,
    sockets: 1,
    cpuOptions: [
      { id: 'epyc-9354p', label: '1x EPYC 9354P 32C', cores: 32, watts: 280 },
      { id: 'epyc-9454p', label: '1x EPYC 9454P 48C', cores: 48, watts: 290 },
    ],
    ramOptionsGB: [256, 512, 768],
    bays: { min: 4, max: 12 },
    driveKeys: ['p5520-3.84', 'p5520-7.68', 'p5520-15.36', 'gen-7.68-g5', 'gen-15.36-g5', 'gen-30.72-g5'],
    nicKeys: ['cx6-hdr200-1p', 'cx6dx-200-1p', 'cx7-ndr400-1p', 'cx7-200-2p'],
    maxDataNics: 2,
    defaultDrive: 'p5520-7.68',
    defaultNic: 'cx7-200-2p',
    psu: '2x 1100W Titanium hot-swap',
    typicalWatts: 750,
    minCluster: 6,
    src: 'Lenovo WEKA Ready Node family (LP1691)',
  },
  'hpe-dl325g11': {
    vendor: 'hpe',
    label: 'ProLiant DL325 Gen11',
    sublabel: 'Single-socket AMD EPYC, EDSFF E3.S',
    ru: 1,
    sockets: 1,
    cpuOptions: [
      { id: 'epyc-9354p', label: '1x EPYC 9354P 32C', cores: 32, watts: 280 },
      { id: 'epyc-9454p', label: '1x EPYC 9454P 48C', cores: 48, watts: 290 },
      { id: 'epyc-9654p', label: '1x EPYC 9654P 96C', cores: 96, watts: 360 },
    ],
    ramOptionsGB: [256, 384, 512, 768, 1024],
    bays: { min: 8, max: 20 },
    driveKeys: ['pm1743-3.84', 'pm1743-7.68', 'pm1743-15.36', 'hpe-3.84-g4', 'hpe-7.68-g4', 'hpe-15.36-g4'],
    nicKeys: ['cx6dx-200-1p', 'cx7-ndr400-1p', 'cx7-200-2p', 'cx7-400-1p-eth'],
    maxDataNics: 2,
    defaultDrive: 'pm1743-7.68',
    defaultNic: 'cx7-200-2p',
    psu: '2x 1600W Titanium hot-swap',
    typicalWatts: 900,
    minCluster: 8,
    src: 'HPE Solutions with WEKA QuickSpecs a00001270enw',
  },
  'hpe-dl345g11': {
    vendor: 'hpe',
    label: 'ProLiant DL345 Gen11',
    sublabel: '2U dual-socket AMD EPYC, up to 36x E3.S',
    ru: 2,
    sockets: 2,
    cpuOptions: [
      { id: 'epyc-9354', label: '2x EPYC 9354 32C', cores: 64, watts: 560 },
      { id: 'epyc-9454', label: '2x EPYC 9454 48C', cores: 96, watts: 580 },
    ],
    ramOptionsGB: [512, 768, 1024, 1536],
    bays: { min: 8, max: 36 },
    driveKeys: ['pm1743-3.84', 'pm1743-7.68', 'pm1743-15.36', 'hpe-3.84-g4', 'hpe-7.68-g4', 'hpe-15.36-g4'],
    nicKeys: ['cx6dx-200-1p', 'cx7-ndr400-1p', 'cx7-200-2p', 'cx7-400-1p-eth'],
    maxDataNics: 2,
    defaultDrive: 'pm1743-7.68',
    defaultNic: 'cx7-200-2p',
    psu: '2x 1600W Titanium hot-swap',
    typicalWatts: 1300,
    minCluster: 8,
    src: 'HPE Solutions with WEKA QuickSpecs a00001270enw',
  },
  'hpe-alletra4110': {
    vendor: 'hpe',
    label: 'Alletra Storage Server 4110',
    sublabel: '1U Intel, 20x EDSFF — SPECstorage 2020_vda reference node',
    ru: 1,
    sockets: 2,
    cpuOptions: [
      { id: 'gold-6548n', label: '2x Xeon Gold 6548N 32C 2.8GHz', cores: 64, watts: 500 },
      { id: 'gold-6442y', label: '2x Xeon Gold 6442Y 24C', cores: 48, watts: 450 },
    ],
    ramOptionsGB: [256, 512, 768, 1024],
    bays: { min: 8, max: 20 },
    driveKeys: ['pm1743-3.84', 'pm1743-7.68', 'pm1743-15.36', 'hpe-3.84-g4', 'hpe-7.68-g4', 'hpe-15.36-g4'],
    nicKeys: ['cx7-ndr400-1p', 'cx7-200-2p', 'cx7-400-1p-eth', 'cx6dx-200-1p'],
    maxDataNics: 2,
    defaultDrive: 'pm1743-7.68',
    defaultNic: 'cx7-ndr400-1p',
    psu: '2x 1600W Titanium hot-swap',
    typicalWatts: 1000,
    minCluster: 8,
    src: 'HPE QuickSpecs a00001270enw; SPECstorage 2020_vda res2025q1-00107',
  },
  'hpe-alletra4210': {
    vendor: 'hpe',
    label: 'Alletra Storage Server 4210',
    sublabel: '1U Gen12-class Intel, 20x E3.S PCIe Gen5',
    ru: 1,
    sockets: 2,
    cpuOptions: [
      { id: 'xeon6-6767p', label: '2x Xeon 6 6767P 64C', cores: 128, watts: 700 },
      { id: 'gold-6548n', label: '2x Xeon Gold 6548N 32C', cores: 64, watts: 500 },
    ],
    ramOptionsGB: [512, 768, 1024, 1536],
    bays: { min: 8, max: 20 },
    driveKeys: ['pm1743-7.68', 'pm1743-15.36', 'gen-30.72-g5'],
    nicKeys: ['cx7-ndr400-1p', 'cx7-400-1p-eth', 'cx7-200-2p'],
    maxDataNics: 2,
    defaultDrive: 'pm1743-15.36',
    defaultNic: 'cx7-ndr400-1p',
    psu: '2x 1600W Titanium hot-swap',
    typicalWatts: 1200,
    minCluster: 8,
    src: 'HPE QuickSpecs a00001270enw / a50009225enw',
  },
  'generic-1u': {
    vendor: 'generic',
    label: 'Generic 1U NVMe server',
    sublabel: 'Vendor-neutral — set every parameter yourself',
    ru: 1,
    sockets: 2,
    cpuOptions: [
      { id: 'g-32', label: '32 cores total', cores: 32, watts: 400 },
      { id: 'g-48', label: '48 cores total', cores: 48, watts: 500 },
      { id: 'g-64', label: '64 cores total', cores: 64, watts: 600 },
      { id: 'g-96', label: '96 cores total', cores: 96, watts: 750 },
    ],
    ramOptionsGB: [128, 256, 384, 512, 768, 1024, 1536],
    bays: { min: 4, max: 24 },
    driveKeys: ['gen-1.92-g4', 'gen-3.84-g4', 'gen-7.68-g4', 'gen-15.36-g4', 'gen-30.72-g4', 'gen-7.68-g5', 'gen-15.36-g5', 'gen-30.72-g5'],
    nicKeys: Object.keys(NICS),
    maxDataNics: 2,
    defaultDrive: 'gen-7.68-g4',
    defaultNic: 'cx6-hdr100-2p',
    psu: '2x redundant hot-swap',
    typicalWatts: 800,
    minCluster: 6,
    src: 'Vendor-neutral template — WEKA generic requirements',
  },
  'generic-2u': {
    vendor: 'generic',
    label: 'Generic 2U dense NVMe server',
    sublabel: 'Vendor-neutral — high drive count per node',
    ru: 2,
    sockets: 2,
    cpuOptions: [
      { id: 'g-48', label: '48 cores total', cores: 48, watts: 550 },
      { id: 'g-64', label: '64 cores total', cores: 64, watts: 650 },
      { id: 'g-96', label: '96 cores total', cores: 96, watts: 800 },
      { id: 'g-128', label: '128 cores total', cores: 128, watts: 950 },
    ],
    ramOptionsGB: [256, 512, 768, 1024, 1536, 2048],
    bays: { min: 8, max: 48 },
    driveKeys: ['gen-3.84-g4', 'gen-7.68-g4', 'gen-15.36-g4', 'gen-30.72-g4', 'gen-7.68-g5', 'gen-15.36-g5', 'gen-30.72-g5'],
    nicKeys: Object.keys(NICS),
    maxDataNics: 2,
    defaultDrive: 'gen-15.36-g5',
    defaultNic: 'cx7-200-2p',
    psu: '2x redundant hot-swap',
    typicalWatts: 1400,
    minCluster: 6,
    src: 'Vendor-neutral template — WEKA generic requirements',
  },
};

const VENDORS = {
  lenovo: {
    label: 'Lenovo',
    full: 'Lenovo EveryScale Design Architecture for WEKA Storage',
    doc: 'https://lenovopress.lenovo.com/lp1698-lenovo-everyscale-design-architecture-for-weka-storage',
    note: 'Entry cluster 6 nodes (4+2P); 8 nodes with 8+2P recommended where growth is expected. Failure domains = server count.',
    switchKeys: ['qm8700', 'sn3700v', 'sn3700c'],
  },
  hpe: {
    label: 'HPE',
    full: 'HPE Solutions with WEKA (QuickSpecs a00001270enw)',
    doc: 'https://www.hpe.com/us/en/collaterals/collateral.a00001270enw.html',
    note: 'Minimum 8 servers for a flash tier. Maximum 3,275 combined servers + client hosts. 100/200/400 Gb Ethernet or InfiniBand.',
    switchKeys: ['qm9700', 'sn5600', 'sn3700v'],
  },
  generic: {
    label: 'Generic / other',
    full: 'Vendor-neutral build to WEKA published requirements',
    doc: 'https://docs.weka.io/planning-and-installation/bare-metal/planning-a-weka-system-installation',
    note: 'Applies only WEKA’s own documented constraints. Validate the final BOM against your vendor’s WEKA-qualified list.',
    switchKeys: Object.keys(SWITCHES),
  },
};

/* Workload presets. `spec` maps each to the closest SPECstorage 2020 workload so the
   tool can anchor estimates to audited public results. */
const WORKLOADS = {
  'ai-training': { label: 'AI / ML training', readMix: 0.8, ioSize: 'Large sequential (≥1 MB)', note: 'GPUDirect Storage path; throughput-led sizing.', fePerNode: 2, spec: 'AI_IMAGE' },
  'hpc': { label: 'HPC / scientific', readMix: 0.7, ioSize: 'Mixed, large checkpoints', note: 'Bursty write checkpoints — size for write throughput too.', fePerNode: 2, spec: 'GENOMICS' },
  'genomics': { label: 'Genomics / life sciences', readMix: 0.75, ioSize: 'Many small files', note: 'Metadata-heavy — favours more RAM per node.', fePerNode: 2, spec: 'GENOMICS' },
  'media': { label: 'Media & entertainment', readMix: 0.6, ioSize: 'Very large sequential', note: 'Sustained streams; network is usually the limit.', fePerNode: 2, spec: 'VDA' },
  'financial': { label: 'Financial / analytics', readMix: 0.85, ioSize: 'Small random (IOPS-led)', note: 'Latency-sensitive — RDMA strongly recommended.', fePerNode: 2, spec: 'EDA_BLENDED' },
  'general': { label: 'General purpose NAS', readMix: 0.7, ioSize: 'Mixed', note: 'Balanced profile.', fePerNode: 2, spec: 'EDA_BLENDED' },
};

/* SPECstorage Solution 2020 workload definitions. */
const SPEC_WORKLOADS = {
  AI_IMAGE: { label: 'AI_IMAGE', metric: 'AI jobs', desc: 'AI/ML image-training pipeline — large sequential reads with checkpoint writes.' },
  GENOMICS: { label: 'GENOMICS', metric: 'genomics jobs', desc: 'Genomic sequencing pipeline — mixed IO over many files.' },
  EDA_BLENDED: { label: 'EDA_BLENDED', metric: 'EDA job sets', desc: 'Chip-design workload — small random IO, metadata heavy, latency sensitive.' },
  VDA: { label: 'VDA', metric: 'video streams', desc: 'Video data acquisition — sustained concurrent write streams.' },
};

/* Audited SPECstorage Solution 2020 submissions running WEKA on bare metal.
   Every figure is copied from the published SPEC result page linked in `url`.
   Cloud submissions exist too but are excluded — they cannot be normalised to a
   per-backend-node basis in a way that is meaningful for on-prem sizing. */
const SPEC_SUBMISSIONS = [
  // --- HPE + WEKA, 12x Alletra Storage Server 4110, published 2025-01-13 ---
  {
    workload: 'AI_IMAGE', vendor: 'HPE + WEKA', solution: 'HPE Alletra Storage Server 4110',
    nodes: 12, cpu: '2x Xeon Gold 6548N (64c)', cpuCores: 64, ramGiB: 512, drives: 16, driveTB: 3.84, drivePcie: 5,
    netGbPerNode: 800, fabric: 'InfiniBand NDR', scheme: '10+2', capacityTiB: 502.87, clients: 24,
    metric: 5000, opsPerSec: 2174983, mbPerSec: 488945, ortMs: 1.06,
    url: 'https://www.spec.org/storage2020/results/res2025q1/storage2020-20250113-00105.html',
  },
  {
    workload: 'GENOMICS', vendor: 'HPE + WEKA', solution: 'HPE Alletra Storage Server 4110',
    nodes: 12, cpu: '2x Xeon Gold 6548N (64c)', cpuCores: 64, ramGiB: 512, drives: 16, driveTB: 3.84, drivePcie: 5,
    netGbPerNode: 800, fabric: 'InfiniBand NDR', scheme: '10+2', capacityTiB: 502.87, clients: 24,
    metric: 5600, opsPerSec: 5403070, mbPerSec: 458896, ortMs: 0.57,
    url: 'https://www.spec.org/storage2020/results/res2025q1/storage2020-20250113-00106.html',
  },
  {
    workload: 'EDA_BLENDED', vendor: 'HPE + WEKA', solution: 'HPE Alletra Storage Server 4110',
    nodes: 12, cpu: '2x Xeon Gold 6548N (64c)', cpuCores: 64, ramGiB: 512, drives: 16, driveTB: 3.84, drivePcie: 5,
    netGbPerNode: 800, fabric: 'InfiniBand NDR', scheme: '10+2', capacityTiB: 502.87, clients: 15,
    metric: 17000, opsPerSec: 7650428, mbPerSec: 123442, ortMs: 0.18,
    url: 'https://www.spec.org/storage2020/results/res2025q1/storage2020-20250113-00104.html',
  },
  {
    workload: 'VDA', vendor: 'HPE + WEKA', solution: 'HPE Alletra Storage Server 4110',
    nodes: 12, cpu: '2x Xeon Gold 6548N (64c)', cpuCores: 64, ramGiB: 512, drives: 16, driveTB: 3.84, drivePcie: 5,
    netGbPerNode: 800, fabric: 'InfiniBand NDR', scheme: '10+2', capacityTiB: 502.87, clients: 24,
    metric: 14400, opsPerSec: 144098, mbPerSec: 66321, ortMs: 1.29,
    url: 'https://www.spec.org/storage2020/results/res2025q1/storage2020-20250113-00107.html',
  },

  // --- Samsung + WekaFS, 6x Dell R7515, published 2022-01-10 ---
  {
    workload: 'AI_IMAGE', vendor: 'Samsung + WekaFS', solution: 'Dell R7515 + Samsung PM9A3',
    nodes: 6, cpu: '1x EPYC 7702P (64c)', cpuCores: 64, ramGiB: 512, drives: 15, driveTB: 3.84, drivePcie: 4,
    netGbPerNode: 800, fabric: '200GbE', scheme: '4+2', capacityTiB: 188, clients: 8,
    metric: 1400, opsPerSec: 608967, mbPerSec: 136899, ortMs: 0.84,
    url: 'https://www.spec.org/storage2020/results/res2022q1/storage2020-20220110-00028.html',
  },
  {
    workload: 'GENOMICS', vendor: 'Samsung + WekaFS', solution: 'Dell R7515 + Samsung PM9A3',
    nodes: 6, cpu: '1x EPYC 7702P (64c)', cpuCores: 64, ramGiB: 512, drives: 15, driveTB: 3.84, drivePcie: 4,
    netGbPerNode: 800, fabric: '200GbE', scheme: '4+2', capacityTiB: 188, clients: 8,
    metric: 1120, opsPerSec: 1117289, mbPerSec: 94890, ortMs: 0.38,
    url: 'https://www.spec.org/storage2020/results/res2022q1/storage2020-20220110-00029.html',
  },
  {
    workload: 'EDA_BLENDED', vendor: 'Samsung + WekaFS', solution: 'Dell R7515 + Samsung PM9A3',
    nodes: 6, cpu: '1x EPYC 7702P (64c)', cpuCores: 64, ramGiB: 512, drives: 15, driveTB: 3.84, drivePcie: 4,
    netGbPerNode: 800, fabric: '200GbE', scheme: '4+2', capacityTiB: 188, clients: 8,
    metric: 3600, opsPerSec: 1619967, mbPerSec: 26141, ortMs: 0.30,
    url: 'https://www.spec.org/storage2020/results/res2022q1/storage2020-20220110-00027.html',
  },
  {
    workload: 'VDA', vendor: 'Samsung + WekaFS', solution: 'Dell R7515 + Samsung PM9A3',
    nodes: 6, cpu: '1x EPYC 7702P (64c)', cpuCores: 64, ramGiB: 512, drives: 15, driveTB: 3.84, drivePcie: 4,
    netGbPerNode: 800, fabric: '200GbE', scheme: '4+2', capacityTiB: 188, clients: 8,
    metric: 8000, opsPerSec: 80052, mbPerSec: 36846, ortMs: 2.05,
    url: 'https://www.spec.org/storage2020/results/res2022q1/storage2020-20220110-00030.html',
  },
];
