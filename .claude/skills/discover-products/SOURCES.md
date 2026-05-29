# SOURCES — discover-products

The credible-source taxonomy for product research + rejection criteria. The principle mirrors the travel siblings: **anchor on sources with real testing and real owner voice; treat SEO/affiliate listicles as candidate-discovery only, never as a quality signal.**

A good product search triangulates **three kinds** of source. Aim for ≥2 expert + retailer review corpus + ≥1 forum, plus the manufacturer for spec truth.

---

## 1. Expert / lab-test sources (the backbone — measured numbers, methodology)

These publish *how* they tested and give numbers you can't get from a spec sheet (measured dB, pint/day at low temp, kWh draw, throughput, latency, etc.).

- **Wirecutter (NYT)** — broad, opinionated, names a clear "our pick / budget pick / upgrade." Strong methodology write-ups.
- **RTINGS** — best for anything they test (TVs, audio, vacuums, monitors, increasingly appliances): standardized lab measurements, comparison tools, numeric scores.
- **Consumer Reports** — reliability survey data (their multi-year brand reliability tables are uniquely valuable for appliances) + lab tests. Paywalled; worth it for durable goods.
- **Category specialists** — the credible specialist for the category: e.g. HVAC/home-systems sites for dehumidifiers/AC; serious-audio sites for headphones; photography sites for cameras; tools sites for power tools. Prefer ones with a named author and a test bench.
- **YouTube teardown / long-term-test channels** — for some categories the best longevity + repairability signal (e.g. teardown channels). Use the transcript/description; verify claims.

## 2. Retailer (top-options discovery + the review corpus)

- **Amazon (primary)** — two jobs: (a) **what the real top options are** (best-seller rank, "Amazon's Choice," high-rating-with-volume — but ignore sponsored slots), and (b) **the review corpus**, especially the **critical reviews** (3-star, then 1-star, verified-purchase, most-recent). Capture the rating histogram.
- **Home Depot / Lowe's** — strong for appliances/tools; their reviews skew different from Amazon's (more contractor/homeowner), good cross-check.
- **B&H / Adorama** — electronics/photo; knowledgeable reviewer base.
- **Best Buy / manufacturer store** — price triangulation + sometimes exclusive SKUs.

Use retailers to find candidates and read owner reviews; **don't take a retailer's bullet specs as canonical** — confirm against the manufacturer (L1).

## 3. Forums / community (reliability + long-term truth — mandatory)

This is where multi-year reliability lives, the thing labs can't measure. **Always include at least one.**

- **Reddit** — `r/BuyItForLife` (longevity gold), `r/<category>` and adjacent (e.g. r/HVAC, r/homeowners, r/HomeImprovement for dehumidifiers; r/headphones, r/coffee, r/Vacuums, r/Tools, r/cars for others). Recipe: Google `site:reddit.com "<brand> <model>"`, navigate `old.reddit.com`, extract comments + scores via `browser_evaluate` (see `discover-restaurants` Step 3).
- **Category forums** — many durable-goods categories have a deep enthusiast forum (e.g. AVS Forum, Head-Fi, coffee forums, tool forums) with multi-year ownership threads.

## 4. Manufacturer (spec truth)

The canonical source for model number, exact ratings, drainage/connectivity options, dimensions, and **warranty terms**. Always confirm the finalists' specs here (Step 7e). Note: the manufacturer is *not* a quality source (it's marketing) — only a spec source.

---

## Rejection criteria (do not let these drive the candidate set or the ranking)

- **Affiliate-spam listicles** — "Top 10 Best X 2026!!!", every link an affiliate tag, no testing, no named author, generic prose. Useful at most to *discover candidate names*; never a quality signal (L5).
- **AI content farms** — no byline, no measured data, suspiciously fluent and contentless, recycled spec-sheet bullets. Reject.
- **Single-vendor "review" sites** — a "review" site that only ever recommends one brand / is owned by a seller.
- **Stale reviews** — older than the current model generation. A glowing review of last year's model number doesn't transfer; verify the exact model is current.
- **Manipulated review listings** — flag (don't fully trust) listings with review-farm signatures: a too-flat high average over huge volume, same-day 5-star bursts, rebranded ASINs inheriting unrelated reviews, thin written content behind the stars (L10).

---

## Per-category seed sources

Add a block per category as searches run, so future searches start warm.

### dehumidifier
- Expert: Wirecutter (dehumidifier guide), Consumer Reports (reliability + tests), RTINGS (if covered), HVAC/home-systems specialist sites with test data.
- Retailer: Amazon, Home Depot, Lowe's.
- Forums: r/HVAC, r/homeowners, r/HomeImprovement, r/BuyItForLife (search "dehumidifier").
- Manufacturer: Frigidaire, hOmeLabs, Midea, GE, Honeywell, Toshiba, Aprilaire (basement/whole-home tier).
- Category notes: basements run cool → low-temp operation / auto-defrost matters; drainage is gravity-hose (drain must be below outlet) vs built-in-pump (can push up); compressor + pump longevity is the dominant reliability risk; Energy Star matters because it runs near-continuously; DOE re-rated pint capacities in 2019 (a "50-pint" new-standard ≈ old "70-pint") — don't compare across rating standards.
