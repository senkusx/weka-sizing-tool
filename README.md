# WEKA Storage Sizing Tool

A browser-based sizing calculator for WEKA storage clusters. Enter a usable-capacity
and/or throughput target, pick a vendor platform, and it solves for the smallest
compliant cluster — then shows the full BOM, capacity breakdown, memory budget,
performance ceilings, and every constraint check it can derive from published docs.

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
| `Dockerfile` / `nginx.conf` / `security-headers.conf` | Container image and web server config |
| `docker-compose.yml` | One-command deployment |

`sizing.js` has no DOM dependency, so it can be required and tested directly in Node.

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

Confirm any committed design with WEKA and your hardware vendor before quoting.
