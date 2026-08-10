/* InferX / Radian Arc reference architecture — compute catalog.

   Node power, weight and rack composition are taken from the "Three Reference
   Architectures — Regional, Core, Edge" and "Rack Design Template 2MW" sheets.
   Every figure below reconciles exactly with the per-rack totals in those
   elevations (verified: air B300 rack 2x13899+1188 = 28986 W; liquid rack
   8x13899+3000+1188 = 115380 W; 128 B300 nodes = 1,779,072 W).

   GPU die specs are cross-checked against open-gpu-db (Apache-2.0). Its TDP
   figures independently agree with the BOM — B300 1400 W, RTX PRO 6000 600 W —
   which is a useful confirmation that the sheets' power model is sound. That
   database carries no memory-bandwidth values, so bandwidth and dense low-
   precision compute are filled in from NVIDIA's published specifications and
   flagged per record. */

/* ---------- accelerators ---------- */
const GPUS = {
  'b300': {
    label: 'NVIDIA HGX B300 (Blackwell Ultra)', short: 'B300',
    memGB: 288, memType: 'HBM3e', bwGBs: 8000, tdpW: 1400,
    denseTFLOPS: { fp4: 15000, fp8: 7500, bf16: 3750 },
    nvlink: true, src: 'NVIDIA Blackwell Ultra spec; TDP confirmed by open-gpu-db and RA BOM',
  },
  'b200': {
    label: 'NVIDIA HGX B200 (Blackwell)', short: 'B200',
    memGB: 180, memType: 'HBM3e', bwGBs: 8000, tdpW: 1000,
    denseTFLOPS: { fp4: 10000, fp8: 5000, bf16: 2250 },
    nvlink: true, src: 'NVIDIA Blackwell spec; TDP per open-gpu-db',
  },
  'h200': {
    label: 'NVIDIA HGX H200 SXM', short: 'H200',
    memGB: 141, memType: 'HBM3e', bwGBs: 4800, tdpW: 700,
    denseTFLOPS: { fp8: 1979, bf16: 989 },
    nvlink: true, src: 'NVIDIA H200 spec; TDP per open-gpu-db',
  },
  'h100': {
    label: 'NVIDIA HGX H100 SXM', short: 'H100',
    memGB: 80, memType: 'HBM3', bwGBs: 3350, tdpW: 700,
    denseTFLOPS: { fp8: 1979, bf16: 989 },
    nvlink: true, src: 'NVIDIA H100 spec',
  },
  'rtx6000b': {
    label: 'NVIDIA RTX PRO 6000 Blackwell Server', short: 'RTX PRO 6000',
    memGB: 96, memType: 'GDDR7', bwGBs: 1792, tdpW: 600,
    denseTFLOPS: { fp4: 3800, fp8: 1900, bf16: 950 },
    nvlink: false, src: 'NVIDIA RTX PRO 6000 Blackwell spec; TDP confirmed by open-gpu-db and RA BOM',
  },
  'l40s': {
    label: 'NVIDIA L40S', short: 'L40S',
    memGB: 48, memType: 'GDDR6', bwGBs: 864, tdpW: 350,
    denseTFLOPS: { fp8: 733, bf16: 362 },
    nvlink: false, src: 'NVIDIA L40S spec; RA BOM budgets 350 W per card',
  },
};

/* ---------- GPU compute nodes (Supermicro, per RA BOM) ---------- */
const GPU_NODES = {
  'smc-b300': {
    label: 'Supermicro AS-8126GS-NB3RT', sublabel: 'NVIDIA HGX B300 8-GPU',
    ru: 8, gpuKey: 'b300', gpuCount: 8, watts: 13899, weightKg: 121,
    cpu: '2x AMD EPYC 9555 64C/128T', cpuCores: 128, ramGB: 6144,
    bootGB: 960, localTB: 61.44,
    eastWest: '8x ConnectX-8 SuperNIC OSFP 800GbE',
    northSouth: 'BlueField-3 2-port 400GbE DPU',
    ewPortsPerNode: 8, ewPortGb: 800, liquidCapable: true,
    // The DLC variant is a 4U chassis, which is how the liquid elevation fits
    // eight nodes plus a CDU into 48U where eight 8U air chassis never would.
    ruLiquid: 4, psuCount: 6,
    src: 'RA BOM + rack elevation (13899 W, 121 kg); 4U DLC chassis per the liquid elevation',
  },
  'dgx-b300': {
    label: 'NVIDIA DGX B300', sublabel: 'NVIDIA Blackwell Ultra 8-GPU (DGX)',
    ru: 10, gpuKey: 'b300', gpuCount: 8, watts: 14500, weightKg: 168,
    cpu: '2x Intel Xeon 6776P', cpuCores: 128, ramGB: 4096,
    bootGB: 1920, localTB: 61.44,
    eastWest: '8x 800G OSFP (ConnectX-8)',
    northSouth: '4x 400G OSFP (BlueField-3)',
    ewPortsPerNode: 8, ewPortGb: 800, liquidCapable: false, psuCount: 12,
    src: 'NVIDIA DGX B300 datasheet: 10U, 14.5 kW (12x 3.3 kW PSU), 168 kg, 2.1 TB HBM3e total. System RAM is the published maximum.',
  },
  'smc-rtx6000': {
    label: 'Supermicro AS-5126GS-TNRT2', sublabel: 'NVIDIA RTX PRO 6000 Blackwell 8-GPU',
    ru: 5, gpuKey: 'rtx6000b', gpuCount: 8, watts: 6529, weightKg: 45.3,
    cpu: '2x AMD EPYC 9555 64C/128T', cpuCores: 128, ramGB: 1536,
    bootGB: 480, localTB: 15.36,
    eastWest: 'BlueField-3 2-port 400GbE DPU',
    northSouth: 'BlueField-3 2-port 400GbE DPU',
    ewPortsPerNode: 2, ewPortGb: 400, liquidCapable: false,
    src: 'RA BOM + rack elevation (6529 W, 45.3 kg)',
  },
  'smc-h200': {
    label: 'Supermicro AS-8125GS-TNHR', sublabel: 'NVIDIA HGX H200 8-GPU',
    ru: 8, gpuKey: 'h200', gpuCount: 8, watts: 10040, weightKg: 110,
    cpu: '2x AMD EPYC 9554 64C/128T', cpuCores: 128, ramGB: 1536,
    bootGB: 480, localTB: 15.36,
    eastWest: 'BlueField-3 B3140H 400GbE / NDR',
    northSouth: 'BlueField-3 2-port 400GbE DPU',
    ewPortsPerNode: 8, ewPortGb: 400, liquidCapable: false,
    src: 'RA BOM component roll-up (901+720+158+7+44+6860+150+1200 W); weight estimated',
  },
  'smc-l40s': {
    label: 'Supermicro AS-4125GS-TNRT2', sublabel: 'NVIDIA L40S 2-GPU',
    ru: 4, gpuKey: 'l40s', gpuCount: 2, watts: 2186, weightKg: 38,
    cpu: '2x AMD EPYC 9554 64C/128T', cpuCores: 128, ramGB: 768,
    bootGB: 480, localTB: 15.36,
    eastWest: 'BlueField-3 2-port 400GbE DPU',
    northSouth: 'BlueField-3 2-port 400GbE DPU',
    ewPortsPerNode: 2, ewPortGb: 400, liquidCapable: false,
    src: 'RA BOM component roll-up (407+720+158+7+44+700+150 W); weight estimated',
  },
};

/* ---------- platform, storage and fabric infrastructure ---------- */
const INFRA = {
  'platform-server': { label: 'Platform Server', model: 'AS-1125HS-TNR', ru: 1, watts: 1070, weightKg: 23.1, c13: 2 },
  'platform-router': { label: 'Platform Router', model: 'AS-1125HS-TNR', ru: 1, watts: 1013, weightKg: 23.1, c13: 2 },
  'cpu-node': { label: 'CPU Compute Node', model: 'AS-1125HS-TNR', ru: 1, watts: 1070, weightKg: 23.1, c13: 2 },
  'tier2': { label: 'Tier 2 Block Storage', model: 'SSG-641E-E1CR36L', ru: 4, watts: 1188, weightKg: 98, c19: 2 },
  'tier3': { label: 'Tier 3 Storage', model: 'Synology RS822RP+', ru: 2, watts: 150, weightKg: 10.88, c13: 2 },
  // Placeholder kept so existing power roll-ups resolve; the real catalogue is
  // WEKAPODS below, which carries per-model capacity and performance.
  'wekapod': {
    label: 'WEKApod node', model: 'WEKApod', ru: 1, watts: 800, weightKg: 9.25, c13: 2,
    nodesPerChassis: 1, chassisRu: 1, readGBs: 70, writeGBs: 40, perApplianceNodes: 8,
    src: 'WEKA WPS155-SAE: 8 nodes in 8RU, ~6.4 kW, ~74 kg',
  },
  'oob-fw': { label: 'OOB Firewall', model: 'Juniper SRX1500', ru: 1, watts: 150, weightKg: 7.3, c13: 2 },
  'serial': { label: 'Serial Switch', model: 'Perle IOLAN SCS48C', ru: 1, watts: 23, weightKg: 3.6, c13: 1 },
  'cdu': { label: 'Supermicro CDU 250 kW', model: 'CDU-250', ru: 4, watts: 3000, weightKg: 114, c19: 2 },
  'patch': { label: 'Patch Panel', ru: 1, watts: 0, weightKg: 5 },
  'breakglass': { label: 'OOB Break-Glass', model: 'RevPi Connect 5 + SITOP', ru: 3, watts: 30, weightKg: 6 },
};

/* Fabric switches. Oversubscription follows the RA: north-south 4:1,
   east-west 1:1 non-blocking. */
const FABRIC = {
  'sn5610': { label: 'NVIDIA SN5610', desc: 'Spectrum-4 800GbE, 64x OSFP', ru: 2, ports: 64, portGb: 800, watts: 940, weightKg: 23.5, c13: 2 },
  'sn4700': { label: 'NVIDIA SN4700', desc: 'Spectrum-3 400GbE, 32x OSFP', ru: 1, ports: 32, portGb: 400, watts: 700, weightKg: 15, c13: 2 },
  'sn4600c': { label: 'NVIDIA SN4600C', desc: 'Spectrum-3 100GbE, 64x QSFP28', ru: 2, ports: 64, portGb: 100, watts: 466, weightKg: 14.64, c13: 2 },
  'sn2201': { label: 'NVIDIA SN2201', desc: '1GbE 48x RJ45 + 4x QSFP28', ru: 1, ports: 48, portGb: 1, watts: 98, weightKg: 7.41, c13: 2 },
};

const FABRIC_RULES = {
  northSouthOversub: 4,   // leaf -> spine 4:1, per the RA cable schedule
  eastWestOversub: 1,     // leaf -> spine 1:1, non-blocking
  oobLeafPorts: 48,
  // The RA specifies MMS4X00-NS twin-port transceivers: one 800G OSFP cage
  // carries 2x400G links, so a 64-cage SN5610 presents 128 logical 400G ports.
  breakout: 2,
};

/* ---------- WEKApod appliance catalogue ----------
   From WEKA's own NeuralMesh / WEKApod material. The Nitro is a 1U server, so
   eight of them occupy 8 rack units — the deck states "Total Nodes 8 / Rack
   Units 8" outright. Per-node power (800 W) agrees with the InferX sheet; the
   weight does not, and WEKA's ~74 kg for eight nodes is used instead of the
   sheet's 31.2 kg each.

   Prime models carry two capacity tiers: a small TLC write/metadata tier plus a
   large eTLC or QLC capacity tier. Usable capacity is sized on the capacity
   tier, which is what the family table quotes. */
const WEKAPODS = {
  'nitro-155': {
    family: 'Nitro', model: 'WPS155-SAE', label: 'WEKApod Nitro — 14 × 7.68 TB TLC',
    ru: 1, drives: 14, driveTB: 7.68, driveType: 'E3.S TLC Gen5',
    cpu: 'AMD EPYC 9534 64C/128T', ramGB: 768, bootDesc: '2 × 960 GB BOSS',
    net: '2 × NVIDIA CX-7 400Gb OSFP', ports: 2, portGb: 400, mgmt: '2 × 1GbE',
    readGBs: 71, writeGBs: 32, readIops: 2.25e6, writeIops: 0.5875e6,
    watts: 800, weightKg: 9.25, minNodes: 8,
    ref: { nodes: 8, netTB: 484, readGBs: 568, writeGBs: 256, readIops: 18e6, writeIops: 4.7e6, ru: 8, kw: 6.4, kg: 74 },
    src: 'WEKA WPS155-SAE: 8 nodes = 484 TB usable at 5D+2P+1VHS, 568/256 GB/s, 18M/4.7M IOPS, 8RU, ~74 kg, ~6.4 kW',
  },
  'nitro-175': {
    family: 'Nitro', model: 'WPS175-SAE', label: 'WEKApod Nitro — 14 × 15.36 TB TLC',
    ru: 1, drives: 14, driveTB: 15.36, driveType: 'E3.S TLC Gen5',
    cpu: 'AMD EPYC 9534 64C/128T', ramGB: 768, bootDesc: '2 × 960 GB BOSS',
    net: '2 × NVIDIA CX-7 400Gb OSFP', ports: 2, portGb: 400, mgmt: '2 × 1GbE',
    readGBs: 71, writeGBs: 32, readIops: 2.25e6, writeIops: 0.5875e6,
    watts: 800, weightKg: 9.25, minNodes: 8,
    ref: { nodes: 8, netTB: 968, readGBs: 568, writeGBs: 256, readIops: 18e6, writeIops: 4.7e6, ru: 8, kw: 6.4, kg: 74 },
    src: 'WEKA WPS175-SAE: 8 nodes = 968 TB usable at 5D+2P+1VHS',
  },
  'nitro-30': {
    family: 'Nitro', model: 'WEKApod Nitro 30TB', label: 'WEKApod Nitro — 14 × 30 TB TLC',
    ru: 1, drives: 14, driveTB: 30, driveType: 'E3.S TLC Gen5',
    cpu: 'AMD EPYC 9534 64C/128T', ramGB: 768, bootDesc: '2 × 960 GB BOSS',
    net: '2 × NVIDIA CX-7 400Gb OSFP', ports: 2, portGb: 400, mgmt: '2 × 1GbE',
    readGBs: 71, writeGBs: 32, readIops: 2.25e6, writeIops: 0.5875e6,
    watts: 850, weightKg: 9.25, minNodes: 8,
    src: 'WEKA Nitro family table: 14 × 7.68 TB–30 TB E3.S TLC, 70/40 GB/s per node',
  },
  'prime-2118-30': {
    family: 'Prime', model: 'Prime 2118', label: 'WEKApod Prime 2118 — 18 × 30 TB eTLC',
    ru: 1, drives: 18, driveTB: 30, driveType: 'E3.S eTLC', writeTier: '2 × 6.4 TB E3.S TLC',
    cpu: '2 × Intel Sierra Forest 64C', ramGB: 1024, bootDesc: '2 × 960 GB BOSS',
    net: '2 × NVIDIA CX-7 400Gb OSFP', ports: 2, portGb: 400, mgmt: '2 × 1GbE',
    readGBs: 40, writeGBs: 20, readIops: 1.3e6, writeIops: 0.35e6,
    watts: 900, weightKg: 12, minNodes: 8,
    src: 'WEKA Prime 2118 family table; performance includes data reduction',
  },
  'prime-2118-60': {
    family: 'Prime', model: 'Prime 2118', label: 'WEKApod Prime 2118 — 18 × 60 TB eTLC',
    ru: 1, drives: 18, driveTB: 60, driveType: 'E3.S eTLC', writeTier: '2 × 6.4 TB E3.S TLC',
    cpu: '2 × Intel Sierra Forest 64C', ramGB: 1024, bootDesc: '2 × 960 GB BOSS',
    net: '2 × NVIDIA CX-7 400Gb OSFP', ports: 2, portGb: 400, mgmt: '2 × 1GbE',
    readGBs: 40, writeGBs: 20, readIops: 1.3e6, writeIops: 0.35e6,
    watts: 950, weightKg: 12, minNodes: 8,
    src: 'WEKA Prime 2118 family table',
  },
  'prime-2218-60': {
    family: 'Prime', model: 'Prime 2218', label: 'WEKApod Prime 2218 — 18 × 60 TB QLC',
    ru: 2, drives: 18, driveTB: 60, driveType: 'U.2 QLC', writeTier: '2 × 6.4 TB U.2 TLC',
    cpu: '2 × Intel Sierra Forest 64C', ramGB: 1024, bootDesc: '2 × 1.92 TB M.2',
    net: '2 × NVIDIA CX-7 400Gb OSFP', ports: 2, portGb: 400, mgmt: '2 × 1GbE',
    readGBs: 40, writeGBs: 20, readIops: 1.3e6, writeIops: 0.35e6,
    watts: 950, weightKg: 20, minNodes: 8,
    src: 'WEKA Prime 2218/2222 family table; 2U chassis with U.2 QLC capacity tier',
  },
  'prime-2218-120': {
    family: 'Prime', model: 'Prime 2218', label: 'WEKApod Prime 2218 — 18 × 120 TB QLC',
    ru: 2, drives: 18, driveTB: 120, driveType: 'U.2 QLC', writeTier: '2 × 6.4 TB U.2 TLC',
    cpu: '2 × Intel Sierra Forest 64C', ramGB: 1024, bootDesc: '2 × 1.92 TB M.2',
    net: '2 × NVIDIA CX-7 400Gb OSFP', ports: 2, portGb: 400, mgmt: '2 × 1GbE',
    readGBs: 40, writeGBs: 20, readIops: 1.3e6, writeIops: 0.35e6,
    watts: 1000, weightKg: 20, minNodes: 8,
    src: 'WEKA Prime 2218/2222 family table — 55 PB in a 42U rack at this density',
  },
};

/* WEKA sizes the WEKApod at 5D+2P with one virtual hot spare, and both published
   worked examples (484 TB and 968 TB) fall straight out of the tool's existing
   net-capacity formula at that setting. */
const WEKAPOD_DEFAULTS = { schemeId: '5+2', hotSpares: 1, minNodes: 8 };

/* ---------- rack and facility rules ---------- */
/* The elevations put exactly 2 GPU nodes in every air-cooled compute rack
   regardless of node size (16 GPUs per rack), and 8 in a liquid-cooled rack
   alongside a 250 kW CDU. Those are the design's own numbers, not a derived
   power fit — an air-cooled B300 rack lands at 29 kW against a 415 V/60 A 3-phase
   feed that could carry more, so the limit is fabric and thermal design rather
   than the PDU. */
const RACK = {
  totalU: 48,
  // Tier 2 block storage is a fixed three units across the whole design, sitting
  // at the base of the first three compute racks. Both the edge and the 2 MW
  // reference designs list exactly three regardless of rack count, which is why
  // their MEP sheet quotes two compute-rack totals: 28,986 W for the racks that
  // carry one and 27,798 W for the rest.
  tier2Units: 3,
  widthMM: 800,
  depthMM: 1470,
  feed: '415V/60A 3Ph',
  cooling: {
    air: { label: 'Air cooled', gpuNodesPerRack: 2, cdu: false },
    liquid: { label: 'Direct liquid cooled (DLC)', gpuNodesPerRack: 8, cdu: true },
  },
  // Management rack composition is fixed across all three reference designs.
  mgmtRack: {
    label: 'Management Rack', watts: 7826, weightKg: 187.18, c13: 23,
    contents: ['patch', 'breakglass', 'oob-fw', 'oob-fw', 'platform-router', 'platform-router',
      'platform-server', 'platform-server', 'platform-server', 'tier3', 'cpu-node', 'cpu-node'],
  },
};

/* ---------- deployment profiles (InferX federation tiers) ---------- */
const RA_PROFILES = {
  edge: {
    label: 'Edge — local inference POP',
    desc: 'One or more GPU nodes with local platform services. No dedicated switch-fabric rack; leaves live in the management rack.',
    minGpuNodes: 1, dedicatedFabricRack: false, storage: 'tier2', defaultNode: 'smc-rtx6000',
  },
  regional: {
    label: 'Regional — GPUaaS POP',
    desc: 'Eight or more GPU nodes with a dedicated switch-fabric rack and a WEKApod POSIX/S3 storage rack.',
    minGpuNodes: 8, dedicatedFabricRack: true, storage: 'wekapod', defaultNode: 'smc-b300',
  },
  core: {
    label: 'Core — AI factory',
    desc: '256 to 2048+ GPUs. Multiple switch-fabric racks, WEKApod storage, and DLC where rack density demands it.',
    minGpuNodes: 32, dedicatedFabricRack: true, storage: 'wekapod', defaultNode: 'smc-b300',
  },
};

/* ---------- model catalog ----------
   kvHeads drives KV-cache size under grouped-query attention, which dominates
   memory at long context. activeParams differs from params only for MoE models:
   capacity follows total parameters, but bandwidth and compute per token follow
   the active set. */
const MODELS = {
  'llama31-8b': { label: 'Llama 3.1 8B', params: 8.03e9, activeParams: 8.03e9, layers: 32, hidden: 4096, heads: 32, kvHeads: 8, headDim: 128, ctxMax: 131072 },
  'llama31-70b': { label: 'Llama 3.1 70B', params: 70.6e9, activeParams: 70.6e9, layers: 80, hidden: 8192, heads: 64, kvHeads: 8, headDim: 128, ctxMax: 131072 },
  'llama31-405b': { label: 'Llama 3.1 405B', params: 405e9, activeParams: 405e9, layers: 126, hidden: 16384, heads: 128, kvHeads: 8, headDim: 128, ctxMax: 131072 },
  'llama32-3b': { label: 'Llama 3.2 3B', params: 3.21e9, activeParams: 3.21e9, layers: 28, hidden: 3072, heads: 24, kvHeads: 8, headDim: 128, ctxMax: 131072 },
  'qwen25-72b': { label: 'Qwen2.5 72B', params: 72.7e9, activeParams: 72.7e9, layers: 80, hidden: 8192, heads: 64, kvHeads: 8, headDim: 128, ctxMax: 131072 },
  'qwen3-32b': { label: 'Qwen3 32B', params: 32.8e9, activeParams: 32.8e9, layers: 64, hidden: 5120, heads: 64, kvHeads: 8, headDim: 128, ctxMax: 131072 },
  'mistral-7b': { label: 'Mistral 7B', params: 7.24e9, activeParams: 7.24e9, layers: 32, hidden: 4096, heads: 32, kvHeads: 8, headDim: 128, ctxMax: 32768 },
  'mixtral-8x7b': { label: 'Mixtral 8x7B (MoE)', params: 46.7e9, activeParams: 12.9e9, layers: 32, hidden: 4096, heads: 32, kvHeads: 8, headDim: 128, ctxMax: 32768, moe: true },
  'gpt-oss-120b': { label: 'gpt-oss-120b (MoE)', params: 116.8e9, activeParams: 5.1e9, layers: 36, hidden: 2880, heads: 64, kvHeads: 8, headDim: 64, ctxMax: 131072, moe: true },
  'gpt-oss-20b': { label: 'gpt-oss-20b (MoE)', params: 20.9e9, activeParams: 3.6e9, layers: 24, hidden: 2880, heads: 64, kvHeads: 8, headDim: 64, ctxMax: 131072, moe: true },
  'deepseek-v3': { label: 'DeepSeek-V3 671B (MoE)', params: 671e9, activeParams: 37e9, layers: 61, hidden: 7168, heads: 128, kvHeads: 128, headDim: 56, ctxMax: 131072, moe: true },
};

/* Bytes per parameter by precision, and the KV-cache precision that normally
   accompanies it. FP8 KV cache is standard practice on Hopper and Blackwell. */
const PRECISIONS = {
  'fp16': { label: 'FP16 / BF16', bytes: 2, kvBytes: 2, flopKey: 'bf16' },
  'fp8': { label: 'FP8', bytes: 1, kvBytes: 1, flopKey: 'fp8' },
  'int8': { label: 'INT8', bytes: 1, kvBytes: 1, flopKey: 'fp8' },
  'fp4': { label: 'FP4 / NVFP4', bytes: 0.5, kvBytes: 1, flopKey: 'fp4' },
  'int4': { label: 'INT4 / AWQ', bytes: 0.5, kvBytes: 1, flopKey: 'fp4' },
};

/* Serving efficiency factors. Decode is memory-bandwidth bound and prefill is
   compute bound; neither reaches the paper peak on a real serving stack, so
   both are derated. These are the least-grounded numbers in the model — they
   come from typical vLLM/TensorRT-LLM behaviour, not from a benchmark in the
   reference architecture. */
const SERVING = {
  bwEfficiency: 0.80,      // achievable fraction of peak HBM bandwidth in decode
  flopEfficiency: 0.55,    // achievable fraction of dense peak in prefill (MFU)
  tpScalingLoss: 0.06,     // per doubling of tensor-parallel width, NVLink
  tpScalingLossPcie: 0.18, // per doubling without NVLink
  workspaceGB: 2.0,        // CUDA context, activations and framework per GPU
  weightOverhead: 1.05,    // packing, embeddings and alignment on top of raw weights
  kvUtilisation: 0.90,     // usable fraction of KV pool after paged-attention fragmentation
};
