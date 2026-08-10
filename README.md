# InferX Solution Sizing Tool

A browser-based sizing calculator for NCP-aligned AI infrastructure, covering both
halves of the solution:

- **Compute** (`compute.html`) — LLM inference sizing against the InferX reference
  architecture: model, precision, concurrency and latency SLOs in; GPUs, nodes,
  racks, power, weight, cooling load and fabric out.
- **Storage** (`index.html`) — WEKA cluster sizing from a usable-capacity and/or
  throughput target, with the full BOM, memory budget and constraint checks.
- **Guided journey** (`wizard.html`) — compute → networking → storage → results,
  with the full solution summary and rack elevations on the final page.
- **Rack elevations** (`rack.html`) — to-scale front and rear views with fabric
  cabling.

## Running it

No build step and no dependencies. Open `index.html` in a browser.

```
open index.html
```

To serve it instead: `python3 -m http.server` and visit `http://localhost:8000`.

## Deploying with Docker

```bash
docker compose up -d          # http://localhost:8080
docker compose down
```

Or without compose:

```bash
docker build -t weka-sizing:latest .
docker run -d --name weka-sizing -p 8080:8080 \
  --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --tmpfs /var/cache/nginx:uid=101,gid=101 \
  --tmpfs /var/run:uid=101,gid=101 \
  --tmpfs /tmp:uid=101,gid=101 \
  weka-sizing:latest
```

The image is nginx-alpine serving the static files — about 76 MB, no build step.
It runs as the unprivileged `nginx` user (uid 101) on port 8080 with a read-only
root filesystem and all capabilities dropped, so the tmpfs mounts above are
required: nginx needs writable scratch for its temp paths and pid file, and they
must be owned by uid 101 or it will fail to start.

`GET /healthz` returns `200 ok` for load balancer and orchestrator probes; the
image also declares a `HEALTHCHECK` against it.

### Published images

Pushes to `main` and `v*` tags build and publish to GitHub Container Registry:

```bash
docker pull ghcr.io/<owner>/weka-sizing-tool:latest
```

CI builds **linux/amd64 and linux/arm64**. This matters: building on an Apple
Silicon workstation produces an arm64-only image that will not run on a typical
x86_64 server, so let CI publish rather than pushing a local build.

Publishing uses the Actions-provided `GITHUB_TOKEN`, so no personal access token
or repository secret is required.

To put it behind TLS, terminate at your reverse proxy or ingress and forward to
port 8080. Nothing in the app calls out to the network and no sizing data ever
leaves the browser, so it is safe to run on an internal network without egress.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure and form |
| `styles.css` | Theme tokens, layout, light/dark |
| `catalog.js` | WEKA platform constants + Lenovo/HPE/generic hardware catalog |
| `sizing.js` | Sizing engine — pure functions, no DOM |
| `app.js` | Form wiring, rendering, charts, CSV export |
| `rack.html` / `rack.css` / `rack.js` | Rack elevation page — front/rear views and fabric cabling |
| `compute.html` / `compute-app.js` | Compute sizing page |
| `wizard.html` / `wizard.css` / `wizard.js` | Guided four-step journey |
| `ra-rack.js` | Reference-architecture rack elevations (compute, fabric, storage, mgmt) |
| `compute-catalog.js` | GPUs, GPU nodes, fabric, rack rules and model catalog from the RA |
| `inference.js` | Inference sizing engine — pure functions, no DOM |
| `Dockerfile` / `nginx.conf` / `security-headers.conf` | Container image and web server config |
| `docker-compose.yml` | One-command deployment |

`sizing.js` has no DOM dependency, so it can be required and tested directly in Node.

## Tests

```bash
node .github/scripts/verify-engine.js
```

These check the engine against figures published by third parties rather than
against our own arithmetic: both Lenovo LP1698 worked examples, the four WEKA
benchmark measurements, and the two SPECstorage reference configurations
reproducing their own published results. If one fails, the tool has started
disagreeing with the documentation it claims to implement.

CI additionally builds the image and asserts that every asset is served, that a
missing path returns 404, that security headers survive the per-location cache
block, and that nginx is not running as root.

## Compute sizing

`compute.html` sizes GPU inference for the InferX reference architecture.

**Reproduced exactly from the reference architecture** (these are regression-tested):

| Check | Value |
|---|---|
| 128x B300 fleet power | 1,779,072 W |
| Air-cooled compute rack (2 nodes + Tier 2) | 28,986 W |
| Liquid-cooled compute rack (8 nodes + CDU + Tier 2) | 115,380 W |
| Air-cooled RTX PRO 6000 rack (2 nodes + Tier 2) | 14,246 W |
| Air-cooled rack without Tier 2 | 27,798 W |
| Liquid-cooled rack without Tier 2 | 114,192 W |
| Tier 2 block storage units | 3 (3,564 W total) |
| 2 MW design, air-cooled | 64 compute + 2 fabric + 1 storage + 1 mgmt = 68 racks |
| 2 MW design, liquid-cooled | 16 compute racks |

The rack rules come straight from the elevations: two GPU nodes per air-cooled
rack, eight plus a 250 kW CDU per liquid-cooled rack, and **exactly three Tier 2
block storage units** across the whole design — at the base of the first three
compute racks, not one per rack. That last rule is what makes the MEP sheet quote
two different compute-rack totals (28,986 W for the racks that carry one, 27,798 W
for the rest), and getting it wrong overstates the 2 MW design by 72 kW. At 27.8 kW an air-cooled
B300 rack sits well inside a 415 V/60 A 3-phase feed, so the two-node limit is a
thermal and fabric choice rather than a power one.

**Sizing basis.** The tool works in both directions:

- **Workload-driven** — state the concurrency and latency target, get the fleet.
- **Fixed GPU nodes** — state the fleet, get the concurrency and throughput it carries.
- **Fixed compute racks** — same, expressed in racks. Cooling decides the nodes per
  rack (2 air, 8 DLC), so 8 racks is 16 nodes air-cooled and 64 liquid-cooled.

Capacity-led sizing flags a shortfall when the fixed fleet cannot carry the stated
load, and errors outright when it is too small to hold even one model replica.

**Inference model.** Memory is exact arithmetic from the model architecture:

```
weights  = params x bytes_per_param x 1.05
KV/token = 2 x layers x kv_heads x head_dim x bytes
```

Throughput is a roofline. Decode streams the active weights once per step plus
the KV of every sequence in the batch, so

```
step_time    = (active_weights + batch x kv_per_seq) / effective_bandwidth
per_user_tps = 1 / step_time
cluster_tps  = batch / step_time
```

Per-user speed therefore falls as batch grows while aggregate throughput rises —
the trade-off the TPOT service level pins down. Prefill is compute bound at
2 FLOPs per active parameter per prompt token. MoE models keep every expert
resident for capacity but only stream the active set, so `activeParams` drives
throughput while `params` drives memory.

**What is derived rather than read from the documents:**

- **Fabric switch counts** follow the RA's oversubscription rules (east-west 1:1
  non-blocking, north-south 4:1) with SN5610 cages treated as 2x400G because the
  BOM specifies MMS4X00-NS twin-port transceivers. On the 2 MW design this derives
  29 SN5610 against the 32 in the elevation, and 13 SN2201 against 12 — close, but
  not a substitute for a real port map.
- **Serving efficiency** — 80% of peak bandwidth in decode, 55% of dense peak in
  prefill. These are the least-grounded numbers in the tool: they reflect typical
  vLLM/TensorRT-LLM behaviour, not a benchmark of this architecture. Validate
  throughput before committing to an SLA.
- **WEKApod form factor** — WEKA ships the Nitro 150 as a **2U four-node chassis**
  (56 TLC drives, 720/186 GB/s, 18M IOPS per 8-node appliance). The reference
  architecture elevation draws one rack unit per node, which overstates the storage
  rack by a factor of two; the tool uses the real chassis. Power and weight per node
  stay at the RA's 800 W / 31.2 kg since WEKA does not publish them.
- **DGX B300** is 10U, 14.5 kW, 168 kg with 12x 3.3 kW PSUs, per NVIDIA's datasheet.
  Its system memory figure is the published maximum.
- **DLC chassis height** — the liquid-cooled B300 is a 4U chassis, which is the only
  way the liquid elevation fits eight nodes plus a CDU into 48U. Air-cooled is 8U.
- **H200 and L40S node power** is rolled up from BOM components rather than stated
  as a total; their weights are estimates. B300 and RTX PRO 6000 node figures are
  stated directly in the elevations.

## Rack elevations

`rack.html` turns the sized cluster into to-scale front and rear rack elevations,
drawn in the flat technical style of VisioCafe / VSD Grafx stencils: dark
charcoal faceplates with drive carriers, bezel LEDs and perforated vent zones on
the front; light grey chassis with PSUs, exhaust perforation and PCIe port cages
on the rear. The rear view overlays the storage fabric cabling, splitting each
node's ports across a redundant top-of-rack switch pair.

It reads the same configuration the sizing page writes to `localStorage`, so the
two stay in sync — edit the sizing inputs and the rack redraws. Opened on its
own it falls back to the default configuration.

Proportions are deliberate rather than decorative. A 2.5" carrier is about 15 mm
across on a 450 mm usable face, so ten of them cover roughly a third of the
width and the remaining bezel is drawn as vent. Switch orientation follows
Lenovo LP1698, which specifies port-side-exhaust switches mounted ports-to-rear —
so the switches show their PSU/fan side on the front elevation and their port
side on the rear, which is where the cabling lands.

Device colours are fixed rather than themed: a rack elevation is a drawing of
physical hardware, so it looks identical in light mode, dark mode and on paper.

This is a planning sketch, not a wiring schedule — port-level assignment, cable
lengths, breakout cabling, PDU placement and out-of-band management are all left
to detailed design.

## What is derived vs modelled

**Taken straight from published documentation** (trust these):

- **Net capacity** — `Net = Raw × (FD − spares)/FD × D/(D+P) × 0.9`, published in Lenovo
  Press LP1698. The engine reproduces both of that document's worked examples exactly
  (96 TB and 498 TB).
- **Per-server memory** — WEKA's published component formula, including the process
  layout rule (one drive process per SSD up to six, then one per two SSDs; two compute
  processes per drive process).
- **Constraints** — protection scheme ranges (D 3–16, P 2–4, stripe 5–20), stripe width
  ≤ failure domains, the 25%-of-cluster stripe advisory, 8000:1 storage-to-RAM ratio,
  30 TB max drive, 19 cores per container, per-vendor minimum cluster sizes.

**Anchored to audited third-party benchmarks**:

- **SPECstorage 2020 projection** — the eight published bare-metal WEKA submissions
  (HPE+WEKA on 12x Alletra 4110, and Samsung+WekaFS on 6x Dell R7515, each across
  AI_IMAGE / GENOMICS / EDA_BLENDED / VDA) are stored verbatim in `SPEC_SUBMISSIONS`,
  normalised per node and scaled by node count.

  This is deliberately *not* a fitted curve. Normalising the two references per node
  shows their ratio swinging from **0.90x (VDA) to 2.50x (GENOMICS)** — two data points
  cannot support a transfer function, so the tool reports the spread as a range and
  shows both reference configurations. Feeding either reference's own hardware back in
  reproduces its published result exactly.

**Modelled** (planning estimates, not guarantees):

- **Peak sequential throughput** — per node, the lowest of the network, drive and CPU
  ceilings; writes additionally pay the `D/(D+P)` parity cost. Calibrated against WEKA's
  published eight-node benchmark to within ~2% on read GB/s, write GB/s and both IOPS
  figures. This is a best case for large sequential IO and sits *above* the SPEC
  projection, which is expected — SPEC workloads are mixed read/write with metadata.
- **Power, rack space and switch counts** — typical figures per platform, not measured.

Coefficients live in `WEKA.perf` in `catalog.js` if you want to retune them. The CPU
term (`gbPerSecPerCore`) is the least constrained by published data — no benchmark in
the set is CPU-bound, so it is an upper bound rather than a fitted value.

## Sources

- [Lenovo EveryScale Design Architecture for WEKA Storage (LP1698)](https://lenovopress.lenovo.com/lp1698-lenovo-everyscale-design-architecture-for-weka-storage)
- [HPE Solutions with WEKA (QuickSpecs a00001270enw)](https://www.hpe.com/us/en/collaterals/collateral.a00001270enw.html)
- [WEKA — Planning a WEKA system installation](https://docs.weka.io/planning-and-installation/bare-metal/planning-a-weka-system-installation)
- [SPECstorage Solution 2020 published results](https://www.spec.org/storage2020/results/) — every submission cited in `SPEC_SUBMISSIONS` links to its own audited result page
- InferX / Radian Arc reference architecture — platform model, the Regional/Core/Edge
  elevations, and the 2 MW rack design template (per-node power, weight, BOM part
  numbers, fabric topology and MEP responses)
- [open-gpu-db](https://github.com/onepunk/open-gpu-db) (Apache-2.0) — GPU specifications;
  its TDP figures independently confirm the RA BOM
- [LLMcalc](https://github.com/kkpkishan/llm-infra-planner) (MIT) — memory and roofline formulas
- [llmsizer](https://github.com/onepunk/llmsizer) (MIT) — quantisation-aware sizing and tensor-parallel scaling

Confirm any committed design with WEKA and your hardware vendor before quoting.
