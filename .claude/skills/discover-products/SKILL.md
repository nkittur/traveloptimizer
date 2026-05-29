---
name: discover-products
description: Build a high-conviction buying recommendation for a product category. Phase 0 is an interactive requirements conversation — lay out the category's real decision dimensions and tradeoffs, then converge on the user's must-haves (hard filters), nice-to-haves (scored), dealbreakers, budget, and context. Then mines expert reviews (Wirecutter/RTINGS-class), Amazon top options + critical/3-star reviews, Reddit, and manufacturer specs with Playwright MCP; pulls LIVE prices; applies hard filters; scores survivors; drills into finalists; and runs a conviction loop until the top pick is robust to the next critical review. Outputs a markdown report + JSON ground truth at searches/<id>/, plus a self-contained HTML buying-guide page in the travel-optimizer webapp (listed under a "Buying guides" section in the picker). Triggered when the user says "find me a <product>", "help me buy a <product>", "what <product> should I get", "product search for <X>", or similar.
user-invocable: true
argument-hint: "<search-id> | <new product to find>"
---

Find the best product in a category **for this user's actual needs** — not the best in the abstract. Sibling of `discover-summer-camps`, `discover-destinations`, and `discover-restaurants`: same multi-source verification discipline, same two-pass philosophy (gather wide + cheap, then drill deep on survivors), same cardinal rule that **every claim traces to a real source**. The unit of work is a **product** (a specific model/SKU within a category), not a city, venue, or program.

**Read the sibling skills first for the shared mechanics**: `../discover-restaurants/SKILL.md` (the canonical Playwright-MCP scrape + Reddit recipe + composition discipline) and `../discover-summer-camps/SKILL.md` (the two-pass, hard-filter-then-score, mark-never-delete, finalist-drill-in discipline). This file documents only the **product-specific differences**: the Phase 0 requirements conversation, critical-review reading, live pricing, and the conviction loop.

**Read this skill's companions before starting:**
- `LESSONS.md` (next to this file) — seeded with the dragons I already see in design. **Read first.** Every entry is a mistake I want to never make.
- `SOURCES.md` (next to this file) — the credible-source taxonomy for product research, and the rejection criteria (content farms, affiliate-spam listicles, fake-review patterns).

---

## What's different from the sibling skills

| Concept | Travel siblings | Product search |
|---|---|---|
| Unit of work | A city / venue / program | A **product** — a specific model/SKU (brand + model number + variant) |
| Distinctive new phase | — | **Phase 0: requirements elicitation.** Figure out what the user actually needs *before* gathering. The whole search is downstream of this. |
| Hard filters | dates / geo / eligibility | **must-haves** (spec thresholds the product must meet) + **dealbreakers** (anti-features critical reviews must not confirm) |
| Scoring buckets | prestige / fit / cost | **derived from the user's stated priorities in Phase 0** — not fixed. (For dehumidifiers: capacity-fit, noise, energy, reliability, drainage-fit, value.) |
| Sources | editorial guides + Reddit | **expert reviews + retailer (Amazon) top options + critical/3-star reviews + Reddit + manufacturer specs** |
| Review focus | Google reviews / Reddit | **3-star, critical, and verified-purchase reviews + expert teardowns** — the honest picture, not the marketing or the 5-star halo |
| Operational data | address / hours | **LIVE price, availability, warranty, real specs** (pulled fresh via Playwright — prices move) |
| Stopping rule | two passes, done | **Conviction loop** — keep drilling/adding candidates until an explicit conviction test passes |
| Output | Supabase / webapp or local md+json | `searches/<id>/report.md` + `products.json` + per-finalist `<slug>-mentions.json`, **plus a self-contained `webapp/products/<id>.html` page surfaced in the picker's "Buying guides" section** (static files, no Supabase) |

The **cardinal rule** for this skill: **every product attribute and every claim in the report traces to a real source** — an expert review, a manufacturer spec page, a retailer listing (with the price's capture date), or a quoted user/Reddit review. A spec you "know" from training but can't point at is labeled `unverified` and verified in Pass 2 or dropped. Recommending a product on a hallucinated spec is the worst failure this skill can have.

---

## Inputs

- **Existing search id** → load `searches/<id>/config.json` and continue from wherever `status` says.
- **New product** → run **Phase 0** (below), then scaffold via `tools/create-product-search.mjs`.

---

## Preconditions

1. **Playwright MCP available.** Amazon, Wirecutter, RTINGS, Reddit, retailer sites are all JS-rendered and/or bot-walled — `mcp__playwright__browser_*` is the only sanctioned scraper. Never WebFetch a price or a review page (it returns a bot wall or stale cache). This is a saved user preference: Playwright for prices, WebFetch fails on JS sites.
2. **Reddit via `old.reddit.com`** — same recipe as `discover-restaurants` Step 3 (Google `site:reddit.com` → navigate `old.reddit.com/r/.../comments/...` → extract comments + scores via `browser_evaluate`).
3. **Claude in Chrome** as a fallback for retailers that hard-block Playwright (some require a logged-in session). Use sparingly, only when Playwright is blocked.
4. **No ghostwheel.** Product preferences are **per-search**, captured in Phase 0, not pulled from ghostwheel — products aren't family-travel state. The single source of truth for a search's requirements is `searches/<id>/config.json` + `requirements.md`. (Exception: if a product is genuinely a family-preference matter — e.g. food — pull the relevant ghostwheel file, but most products won't be.)

---

## Pipeline order

```
 Phase 0 (requirements — INTERACTIVE, do not skip or guess):
   Step 0  Elicit needs → write config.json (must_haves/nice_to_haves/dealbreakers/weights)
           + requirements.md.  USER SIGNS OFF before any gathering.

 Pass 1 (gather + filter + score — wide and cheap):
   Step 1  Load search config + requirements
   Step 2  Pick sources (expert roundups, retailer top-options, forums, manufacturer)
   Step 3  Scrape via Playwright MCP → save raw dumps
   Step 4  Normalize + cross-source merge → products.json (status='candidate')
   Step 5  Hard filters (must_haves) → mark rejected with reason (mark, never delete)
   Step 6  Score survivors against the Phase-0 weighted buckets → top 5–8 finalists

 Pass 2 (drill into finalists + converge — narrow and deep):
   Step 7  Per finalist: LIVE price, critical/3-star reviews, expert teardown, Reddit,
           spec verification → save <slug>-mentions.json
   Step 8  CONVICTION LOOP — re-rank; run the conviction test; iterate if it fails
   Step 9  Compose write-ups (honest, tradeoff-forward; the recommendation + why the runner-up loses)
   Step 10 Render report.md + finalize products.json
   Step 10b Render the webapp buying-guide page + update the picker manifest
   Step 11 Report to user: the pick, the runner-up, the tradeoff, the price + where
```

**Why two passes?** Same reason as the siblings: Pass 1 casts a wide net cheaply (text scraping of roundups + retailer listings), Pass 2 spends the expensive verification (per-product critical-review reading, live price checks, spec confirmation, Reddit drill-in) only on the 5–8 survivors that scored well enough to matter. Reading every 1-star review of 40 candidates is wasted work; reading them for 6 finalists is exactly right.

---

## Step 0 — Phase 0: requirements elicitation (the distinctive step)

This is the step that makes the recommendation *yours* and not a generic listicle. **It is a conversation, not a form.** Skipping it — jumping straight to "best dehumidifiers 2026" — is the single biggest failure mode (L0). Do not guess the user's needs; surface the decisions and let them decide.

The shape of the conversation:

1. **Bring category expertise.** State the **real decision dimensions** for this category and, for each, the **tradeoff** that makes it a decision (not a free lunch). The user shouldn't have to know the category's jargon — that's the skill's job. Example dimensions for a dehumidifier: *capacity/coverage* (bigger = louder + larger footprint + more $), *drainage* (gravity hose needs the drain **below** the unit; built-in pump can push **up/across** to a sink but costs more and is another failure point), *noise* (dB at distance; compressor vs desiccant), *energy* (Energy Star kWh/yr — it runs constantly), *low-temp operation* (basements are cold; compressors ice up — look for auto-defrost / low-temp rating), *humidistat accuracy + auto-restart after power loss*, *reliability/brand* (this category has notorious 1–2yr compressor-death patterns — reliability is a real axis, not a nicety).

2. **Separate the three tiers explicitly:**
   - **Must-haves** → become **hard filters** (Step 5). A product failing one is rejected. Be conservative about what's truly a must — every must shrinks the field. ("Has continuous-drain hose port" is a real must; "white" usually isn't.)
   - **Dealbreakers** → anti-features that critical reviews must not confirm (e.g. "dies in 18 months," "pump fails and floods"). These are tested against *critical reviews*, not specs.
   - **Nice-to-haves** → become **scored buckets** (Step 6), weighted by stated priority.

3. **Pin the budget** — a comfortable target and (optionally) a hard ceiling. "No cap, optimize value" is a valid answer; record it as such.

4. **Capture context** — the facts that constrain the choice (basement square footage, how damp, ambient temp, where the unit sits relative to the drain, ceiling height/footprint limits). These feed both filters and sizing.

5. **Rank priorities** — what to optimize when products trade off against each other. This becomes the **scoring weights**. Use `AskUserQuestion` to present the key forks with the tradeoffs spelled out in the option descriptions; follow up conversationally on anything ambiguous.

6. **Write the spec and get sign-off.** Scaffold the search, then write `must_haves`, `dealbreakers`, `nice_to_haves`, `scoring_weights`, `context`, and `budget_usd` into `config.json`, and a readable `requirements.md`. **Show the user the requirements summary and confirm before gathering.** This is cheap to change now and expensive to change after 40 products are scored against the wrong spec.

```bash
node tools/create-product-search.mjs \
  --id basement-dehumidifier-2026 \
  --category dehumidifier \
  --use-case "Basement; continuous drain to floor drain; quiet" \
  --budget-max 400 --by Niki
# then write the full requirements into searches/<id>/config.json + requirements.md
```

Set `config.status = 'gathering'` once the user signs off.

---

## Step 2 — Pick sources

See `SOURCES.md` for the full taxonomy and rejection criteria. The **source budget** for a product search:

- **Expert / lab-test sources (≥2, the backbone).** Wirecutter, RTINGS, Consumer Reports, plus the credible category specialist (for dehumidifiers: HVAC/home sites with real testing; *Sweethome*-class). These give measured numbers (dB readings, pint/day at 65°F vs 80°F, kWh/yr) instead of marketing. **Prefer sites that publish a methodology.**
- **Retailer (Amazon is primary, plus 1–2 others).** Two jobs: (a) **what the top options actually are** — best-sellers, "Amazon's Choice," highly-rated-with-volume; and (b) **the review corpus**, especially the **critical reviews** (see Step 7). Also Home Depot / Lowe's / B&H / manufacturer store for price triangulation.
- **Reddit + forums (mandatory).** `r/<category>`-adjacent subs (for dehumidifiers: r/HVAC, r/homeowners, r/HomeImprovement, r/BuyItForLife). This is where multi-year reliability and "mine died in 14 months" signal lives — the thing labs can't measure because they don't run units for two years. BuyItForLife threads are gold for the reliability axis.
- **Manufacturer spec page** — for the canonical spec (model number, exact capacity rating, dimensions, warranty terms, whether the pump is built-in or an add-on). Specs from a retailer listing are often wrong/stale; confirm against the manufacturer.

**Rejection criteria** (see SOURCES.md for the full list): affiliate-spam listicles ("Top 10 Best!!! 2026" with no testing, every link an affiliate tag), AI content farms (no named author, generic prose, no measured data), single-vendor "review" sites, and reviews older than the current model generation. **Fake-review awareness:** a product with thousands of reviews at a suspiciously flat 4.7★ and bursts of same-day 5-star reviews is a flag — note it and lean on expert + Reddit signal instead.

---

## Step 3 — Scrape with Playwright MCP

Mechanics are identical to `discover-restaurants` Step 3 — read that. Product-specific notes:

- **Amazon listing scrape** (per candidate): capture title, **brand + model number**, current price + list price, star rating + review count, "Amazon's Choice"/best-seller badges, the key bullet specs, and the review-distribution histogram (the % at each star). Save the histogram — it's how you find the critical reviews in Step 7.
- **Amazon search-results scrape** (to find top options): scrape the category search + best-seller list; capture the top ~15–25 by rating×volume, not just page 1 order (sponsored slots pollute page 1). De-dupe variants of the same model (color/size SKUs are the same product for our purposes — L9).
- **Expert roundup scrape**: capture the publication's ranked picks with their *measured* numbers and their stated pick rationale ("our pick," "budget pick," "also great"). These are the editorial anchor.
- **Save raw to disk** as `searches/<id>/raw/<source>-raw.json` (e.g. `amazon-search-raw.json`, `wirecutter-raw.json`, `rtings-raw.json`, `reddit-<sub>-thread-<N>.json`). Composition and the conviction loop re-read these.
- **Verify scrape completeness** — same rule as siblings: if the roundup lists 8 picks and you captured 3, re-check pagination/expanders.

---

## Step 4 — Normalize + cross-source merge

Write one per-search normalizer at `searches/<id>/_normalize.mjs` (products aren't restaurants — no per-category file). It translates each raw scrape into the canonical product shape and merges across sources.

### Canonical product shape

```json
{
  "slug": "frigidaire-fghd5050-2026",
  "name": "Frigidaire Gallery 50-Pint with Pump",
  "brand": "Frigidaire",
  "model_number": "FGAC5044W1",
  "variants_merged": ["FGAC5044W1 (white)", "..."],
  "category": "dehumidifier",
  "specs": {
    "capacity_pint_day_doe": 50,
    "coverage_sqft": 4500,
    "drainage": ["tank", "gravity-hose", "built-in-pump"],
    "noise_db": 51,
    "noise_source": "rtings-measured",
    "energy_star": true,
    "kwh_year": 646,
    "low_temp_rated_f": 41,
    "auto_defrost": true,
    "dimensions_in": [24.4, 16.5, 13.0],
    "warranty": "1yr parts+labor / 5yr sealed system",
    "spec_confidence": "verified"
  },
  "price": { "amount_usd": null, "list_usd": null, "retailer": null, "url": null, "captured_at": null },
  "ratings": {
    "amazon": { "stars": 4.4, "count": 8123, "histogram": {"5":62,"4":18,"3":8,"2":4,"1":8}, "fake_flag": false },
    "expert": [ { "source": "rtings", "score": "8.1", "verdict": "our value pick", "url": "..." } ]
  },
  "status": "candidate",
  "rejection_reason": null,
  "scores": {},
  "composite_score": null,
  "ranking": null,
  "highlights": null,
  "sources": [
    { "type": "expert", "publication": "RTINGS", "url": "...", "verified": true },
    { "type": "retailer", "retailer": "Amazon", "url": "..." },
    { "type": "reddit", "threads": [...], "mentions": 3, "detail": "r/HVAC — 3 threads" },
    { "type": "manufacturer", "url": "...", "verified": true }
  ]
}
```

**`spec_confidence`** is `verified` (confirmed on the manufacturer page or a lab-test source) or `unverified` (from a retailer bullet or training knowledge only). Unverified specs must be confirmed in Pass 2 before they back a filter decision or a report claim (L1).

### Cross-source merge (port from restaurants Step 4b)

Merge axis is **(brand, model_number)** — and crucially, **collapse SKU variants of the same model** (color, region) into one product (L9). Build an explicit `CANONICAL_MERGES` table; do not fuzzy-substring-merge ("hOmeLabs 50 Pint" vs "hOmeLabs 35 Pint" are different products). Same model from Amazon + RTINGS + Reddit + manufacturer → one product with four sources.

```bash
node searches/<id>/_normalize.mjs > searches/<id>/products.json
```

---

## Step 5 — Apply hard filters (must-haves)

Read `config.must_haves`. For each product, run the filters in a stable order, **stopping at the first failure** (clean rejection-reason attribution). The filters are **search-specific** — they come from Phase 0, not a fixed list. Generic ordering:

| Order | Filter | Rejection reason |
|---|---|---|
| 1 | **Spec must-haves** — each `must_have` with a spec `test` (e.g. `drainage includes gravity-hose`, `capacity_pint_day >= 30`, `noise_db <= 52`). | `missing-<key>` |
| 2 | **Budget** — `price <= budget.max` (skip if `max` null; if price not yet known, pass with `price_pending: true` and resolve in Pass 2). | `over-budget` |
| 3 | **Availability** — discontinued / unavailable products go to an appendix, not the main rejected list (sometimes the successor model is the real answer). | `discontinued` |

**Dealbreakers are NOT filtered here** — they're anti-features confirmed by *critical reviews*, which you only read in Pass 2. A dealbreaker can demote a finalist during the conviction loop (Step 8). Don't pre-reject on a dealbreaker you haven't seen evidence for.

**Mark, never delete.** Set `status='rejected'`, `rejection_reason='<code>'`. A product passing all filters stays `candidate`.

---

## Step 6 — Score survivors

Score each survivor 0–5 per bucket. **Buckets and weights come from Phase 0** (`config.scoring_weights`), so they reflect *this* user's priorities. Scores are evidence-grounded judgment calls, not formulas. A representative dehumidifier rubric (yours will differ per the requirements):

| Bucket | Rubric (5 = best) |
|---|---|
| `capacity_fit` | 5 = sized right for the space with headroom; over/undersized loses points (oversized = needless noise/cost, undersized = runs constantly). |
| `noise` | 5 = measured ≤ ~46 dB at distance; 3 = ~50 dB; 1 = loud/whiny or many "sounds like a jet" reviews. Prefer **measured** dB over spec-sheet dB (L4). |
| `drainage_fit` | 5 = drainage mode matches the user's setup exactly (gravity hose for a below-unit floor drain; built-in pump if it must go up). |
| `energy` | 5 = Energy Star + low kWh/yr for its class. It runs constantly, so this is real money. |
| `reliability` | 5 = strong multi-year BuyItForLife/Reddit signal + good warranty + no critical-review death pattern; 1 = repeated "died in <2yr" reports. **This is weighted heavily for this category** (L6). |
| `value` | 5 = clearly strong price for the measured performance; penalize paying for unused capacity/features. |

Default weights are **derived from the user's ranked priorities in Phase 0** — don't hardcode them here. `composite_score = Σ(wᵢ·sᵢ) / Σ(wᵢ)`. Mark the top **~10** `status='finalist'` with `ranking` set.

**Breadth norm (L15):** Pass 1 must enumerate a genuinely wide field — **aim for 50+ candidates** before filtering (sweep the retailer with several queries: by-capacity, "quiet", and by-brand for every credible brand — Honeywell, Frigidaire, GE, Danby, TCL, Toshiba, LG, Midea, hOmeLabs, Hisense, etc., plus the no-name cluster). Then **shortlist ~10** to score deeply and plot. A 4–6 candidate set looks thin and silently drops real contenders (e.g. skipping Honeywell because it's "hard to find" without checking its price). Keep **every** considered model in `products.json`'s `considered[]` array with a `status` (`shortlisted`/`excluded`/`rejected`) and a one-line `reason` — that array powers the audit tab and is the proof you actually looked wide.

---

## Step 7 — Drill into finalists (mandatory Pass 2 work)

Skipping this is the biggest quality failure (mirror of the siblings). The Pass-1 ranking is a hypothesis built on roundups and spec sheets; Pass 2 is where you read what owners actually say and pull the live price. For each of the 5–8 finalists:

### 7a · Pull the LIVE price (and where)
Navigate the Amazon listing **now** (prices and availability move daily — a cached/roundup price is not trustworthy, L2). Capture `amount_usd`, `list_usd`, `retailer`, `url`, `captured_at` (today). Triangulate against one other retailer; if Amazon is wildly higher, note the cheaper source. Re-check the budget filter against the live price.

### 7b · Read the CRITICAL reviews (the honest picture — the heart of this skill)
The 5-star reviews are the marketing in disguise; the **3-star reviews are the most informative** (they liked it enough to keep it but hit real limits), and the **1–2 star reviews reveal the failure modes**. On the Amazon listing:
1. Filter reviews to **3-star**, then **1-star**, then **verified-purchase + most-recent** (recent 1-stars catch a quality decline in the current production run — L7).
2. Read for **patterns, not anecdotes** — one angry review is noise; *fifteen reviews saying the pump fails at ~12 months* is a confirmed dealbreaker. Quantify ("~20% of 1-stars cite the same compressor failure").
3. Explicitly test each `config.dealbreaker` against what you find. A confirmed dealbreaker demotes or rejects the finalist in Step 8.
4. Note the **fake-review flag** if the histogram/timing looks manipulated; down-weight that listing's stars accordingly.

### 7c · Read the expert teardown
Pull the finalist's full write-up from the expert sources (not just its rank): the measured numbers, what the testers disliked, who they say it's *not* for. This is where you get trustworthy dB and pint/day-at-low-temp figures to correct spec-sheet optimism.

### 7d · Drill Reddit for THIS product (reliability + long-term)
Same recipe as `discover-restaurants`: `site:reddit.com "<brand> <model>"` and the common shorthand. Pull threads with real discussion; extract comments + scores. Look for **multi-year ownership** reports, the reliability verdict, and sleeper alternatives ("don't buy X, get Y, mine's run 6 years"). A strong BuyItForLife thread can outrank a lab score.

### 7e · Verify the spec
Confirm the model number, capacity rating, drainage options (is the pump built-in or a separate accessory? — L3), dimensions, and warranty against the **manufacturer** page. Flip `spec_confidence` to `verified` or correct the value. A filter decision (Step 5) that rested on an unverified spec must be re-checked here.

Save per-finalist `searches/<id>/<slug>-mentions.json` — the single ground truth for composition:

```json
{
  "product": "Frigidaire Gallery 50-Pint with Pump",
  "model_number": "FGAC5044W1",
  "live_price": { "amount_usd": 329, "retailer": "Amazon", "captured_at": "2026-05-28", "url": "..." },
  "sources_drilled": ["amazon-reviews", "rtings", "r/HVAC", "manufacturer"],
  "critical_review_patterns": [
    { "theme": "pump failure ~12mo", "prevalence": "~18% of 1-star", "verdict": "confirmed dealbreaker risk" },
    { "theme": "louder than expected", "prevalence": "common in 3-star", "verdict": "minor" }
  ],
  "mentions": [
    { "source": "r/HVAC", "score": 41, "text": "Frigidaire compressors are solid; pump is the weak point — plumb gravity drain instead", "url": "..." },
    { "source": "rtings", "text": "Measured 51 dB — middle of the pack; 8.1 overall, value pick", "url": "..." },
    { "source": "amazon-3star", "text": "Works great but the bucket sensor is twitchy", "url": "..." }
  ]
}
```

---

## Step 8 — The conviction loop

This is the "keep going until we're confident" the skill exists for. After drilling the finalists, re-score and re-rank with the Pass-2 evidence (live price, confirmed specs, critical-review patterns, Reddit reliability). Then run the **conviction test**. Proceed to compose **only when all pass**:

1. **Triangulation** — the top 2–3 each have **≥3 independent credible sources** (≥1 expert + retailer-with-reviews + Reddit/forum). A leader resting on one source is not yet trustworthy.
2. **No unbroken dealbreaker on the leader** — the top pick's critical reviews and Reddit reveal no *confirmed* dealbreaker (a pattern, not one-off). If they do, demote it and re-rank.
3. **The tradeoff is understood** — you can state, in one sentence, **why the runner-up loses to the leader** (and for whom the runner-up would actually be the better pick). If you can't articulate this, you haven't drilled enough — the ranking is arbitrary.
4. **Completeness critic** — run a final "what's missing?" pass: an unexamined decision dimension from Phase 0? a top-selling option that never got scored? a finalist whose critical reviews you skimmed? a spec still `unverified`? If yes → **loop**: add the candidate / read the reviews / verify the spec, then re-test.

If any test fails, **iterate** — add a source, promote a near-miss into the finalist set, read more critical reviews, or drill the missing dimension — then re-run the test. Cap the loop at a sane number of iterations (≈3); if conviction still isn't reached, **say so honestly** in the report ("top two are a real toss-up because X is unresolved") rather than manufacturing false confidence. Record the outcome in `config.conviction`.

---

## Step 9 — Compose write-ups (honest, tradeoff-forward)

Composition discipline is identical to the siblings (`discover-restaurants` Step 4c, `discover-summer-camps` Step 8) — **read those.** No credentials-prefix, no "r/Sub N mentions" coda, no per-source attribution in prose (the badges carry it), no padding. Every named fact and quoted phrase traces to `<slug>-mentions.json`. Product-specific voice:

- **Voice: a knowledgeable friend who has done the homework.** Lead with what the product *is* and who it's *for*, then the one or two things that put it on the shortlist, then the honest caveat (the thing the 3-star reviews revealed). State the **live price + where**.
- **The recommendation must name the tradeoff.** Don't just crown a winner — say why the runner-up loses and for whom it would win. ("Pick the X if quiet matters most; the Y is $60 cheaper and slightly more reliable but noticeably louder — get it if the unit lives in an unfinished corner you never sit near.")
- **Critical reviews are content, not garnish.** If a confirmed failure pattern exists, it goes in the write-up plainly ("~1 in 5 one-star reviews report the pump failing around the one-year mark — plumb the gravity drain and skip the pump").
- Write the composed paragraph(s) back to `product.highlights` in `products.json`.

---

## Step 10 — Render report.md + finalize products.json

`searches/<id>/report.md` is the deliverable. Structure (use as `##` headers, in order):

```markdown
# <Category> — buying recommendation for <use case>

**Search:** <id>   ·   **Run date:** <date>
**Use case:** <one line>
**Budget:** <target / max>
**Must-haves:** <list>   ·   **Optimizing for:** <ranked priorities>

---

## The recommendation
**<Winner>** — $<live price> at <retailer>.  <One-paragraph why, including the tradeoff vs the runner-up.>
**Runner-up: <name>** — <when this is the better pick instead>.
**Conviction:** <reached / "close call because X"> — <one line>.

## How we got here
- Sources mined: <N expert, M retailer listings, K forum threads>
- Products considered: <N>   ·   Hard-filter rejects: <N> (breakdown by reason)
- Finalists drilled: <N>   ·   Conviction-loop iterations: <N>

## Finalists (ranked)

### 1. <Product> — <Brand>  ·  $<live price> at <retailer>
| | |
|---|---|
| **Key specs** | <capacity / noise(measured) / drainage / energy / dimensions> |
| **Price** | $<amount> (list $<list>) at <retailer>, as of <captured_at> |
| **Warranty** | <terms> |
| **Critical-review read** | <the honest summary: confirmed issues + prevalence> |
| **Source badges** | expert: RTINGS ✓ · Amazon (4.4★, 8.1k) · r/HVAC (3 threads) · mfr ✓ |
| **Composite score** | <X.X/5.0> |

<composed write-up — what it is, who it's for, why shortlisted, the honest caveat>

**Sources:**
- <expert-url> — <publication>, <verdict>
- <reddit-url> — r/<sub> (<score>▲)
- <manufacturer-url> — spec verification

**Score breakdown:** capacity_fit X/5 · noise X/5 · drainage_fit X/5 · energy X/5 · reliability X/5 · value X/5

<repeat for each finalist>

## Rejected (audit trail)
Grouped by rejection_reason; each: product — brand — one-line reason.

## Discontinued / unavailable (with successors)
<product — its successor model, if the successor is the real answer>

## Notes / open questions
- <unverified spec we couldn't confirm; recommend checking before purchase>
```

**Hard rules:** every fact in a finalist block traces to `products.json`; the source badges reflect actual `sources[]` (no "expert ✓" without an expert source — the L0-class violation); the score breakdown reuses `scores`, it's not a re-judgment; every price carries its `captured_at` date.

Write the final `products.json` (with composition) and the `<slug>-mentions.json` files. Leave `raw/` intact for audit + refresh.

For the renderer in Step 10b to work, `products.json` must carry, in addition to the per-product rows:
- a top-level **`verdict`** object: `{ headline, pick_slug, pick_price_usd, pick_blurb, runner_up_slug, runner_up_blurb, tradeoff, headroom_slug?, headroom_blurb?, avoid }` — the conviction-bearing summary;
- a **`title`** + **`subtitle`** for the page header;
- per-finalist **`highlights`** (the composed write-up);
- rejected-on-dealbreaker products with **`rejection_reason`** + **`dealbreaker_evidence`** (and `ratings.amazon.histogram_pct` if you have it).

These exist so the renderer is a **pure templater** — it composes nothing.

---

## Step 10b — Render the webapp buying-guide page

The deliverable isn't just a markdown file — it's a browsable, conviction-bearing **page in the travel-optimizer webapp**, listed under a **"Buying guides"** section in the picker (home page). The user opens it to evaluate and gain conviction without reading raw JSON.

```bash
node tools/render-product-page.mjs <search-id>
```

This reads `searches/<id>/{products.json, config.json, pareto.svg}` and writes:
- `webapp/products/<id>.html` — a **self-contained**, **tabbed** page (inline CSS, inlined Pareto SVG, tiny inline tab script; no Supabase/JS dependency):
  - **Recommendation tab:** verdict banner (pick · price · blurb · runner-up · budget-pick · tradeoff · conviction), the Pareto chart (plots the ~10 shortlist), "what we optimized for" (must-haves + weight chips), ranked finalist cards (spec table + score bars + source chips + the honest write-up), and the **rejected/dealbreaker** section (the obvious pick that isn't, with the evidence quotes).
  - **Audit tab (required):** a table of **every source** used (type · link · credibility · what it was used for), and a table of **all considered options** (the 50+) with brand/model/capacity/price/rating/status and a `reason` for each — i.e. **why each non-shortlisted option was ruled out**. This is the auditability the user expects; never ship the page without it.
- `webapp/products/index.json` — the **manifest** the picker reads. The renderer upserts this search's entry (newest first).

**Why static files, not Supabase:** product searches are file-based (V1). The picker (`webapp/js/picker.js`) fetches `/products/index.json` and renders a "Buying guides" section whose cards link to `/products/<id>.html`. Vercel serves these as real static files (the catch-all rewrite in `vercel.json` is only a fallback for non-existent paths). If you change `picker.js`, **bump its `?v=` cache token in `webapp/index.html`** or the browser serves the stale module.

The renderer is a templater: if a fact isn't in `products.json`, it doesn't appear. Don't add prose in the renderer — fix the data.

**Deploy:** the page goes live when `webapp/` is deployed to Vercel (the user's normal deploy). Locally, QA with `python3 -m http.server` from `webapp/` and open `/products/<id>.html` and `/` (the picker).

---

## Step 11 — Report to user

```
Product search <id> complete.

  Recommendation:    <Winner> — $<price> at <retailer>
  Runner-up:         <Name> — <one-line when-instead>
  The tradeoff:      <one line>
  Conviction:        <reached / close call because X>

  Sources mined:     N expert, M retailer listings, K forum threads
  Products considered: <N>   ·   Finalists: <N>   ·   Loop iterations: <N>

  Report:   searches/<id>/report.md
  Data:     searches/<id>/products.json
  Raw:      searches/<id>/raw/

  Open questions:
    - <followup>
```

---

## Refresh mode

A re-run against an existing `<id>` should: re-pull **live prices** for the finalists (the thing most likely to have changed); re-read **recent** critical reviews (catches a current-run quality decline, L7); check whether any finalist was **discontinued or superseded**; re-score and re-test conviction; mark `status_change: new | removed | price-changed | superseded`; re-compose only where evidence materially changed.

---

## Common failure modes

| Symptom | Root cause | Fix |
|---|---|---|
| Recommended a product the user can't actually use (wrong drainage) | L0 — skipped/guessed Phase 0 requirements | Run Phase 0; get must-have sign-off before gathering |
| Report cites a price that's wrong at checkout | L2 — used a roundup/cached price | Pull LIVE price in Step 7a with `captured_at` |
| Backed a filter decision on a spec that was wrong | L1 — trusted a retailer bullet / training knowledge | `spec_confidence`; verify against manufacturer in 7e |
| Pump "included" turned out to be a separate accessory | L3 — conflated capability with what's in the box | Verify built-in vs add-on on the manufacturer page |
| Picked the quiet-on-paper unit that owners say is loud | L4 — trusted spec-sheet dB over measured | Prefer measured dB (RTINGS-class); cross-check reviews |
| Two listings scored as two products (same model, different color) | L9 — SKU-variant not merged | Merge on (brand, model_number); collapse variants |
| Recommended a unit with a known compressor-death pattern | L6/L7 — didn't weight reliability / didn't read recent 1-stars | Heavy reliability weight; read recent verified 1-stars for patterns |
| "Best of" listicle drove the picks | SOURCES.md violation — affiliate-spam source | Demote affiliate listicles; anchor on lab-test + Reddit |
| Crowned a winner but can't say why over #2 | Conviction test 3 failed | Drill the tradeoff until you can state it in one sentence; else say it's a toss-up |
| Report claims a detail no source supports | Composition fabricated | Forbidden — every claim traces to `<slug>-mentions.json` |

---

## Related files
- `LESSONS.md` — seed lessons; append `as-confirmed-by` after each run.
- `SOURCES.md` — credible-source taxonomy + rejection criteria + fake-review patterns.
- `../discover-restaurants/SKILL.md` — canonical Playwright-MCP scrape + Reddit recipe + composition discipline.
- `../discover-summer-camps/SKILL.md` — closest structural sibling: two-pass, hard-filter-then-score, finalist drill-in.
- `tools/create-product-search.mjs` — scaffolds `searches/<id>/{config.json, requirements.md}` + `raw/`.
- `tools/render-product-page.mjs` — renders the self-contained webapp buying-guide page + updates the picker manifest (Step 10b).
- `searches/<id>/_normalize.mjs` — per-search normalizer (canonical shape + the `CANONICAL_MERGES` variant-collapsing table).
- `webapp/products/<id>.html` + `webapp/products/index.json` — the rendered page + the picker's "Buying guides" manifest.
- `webapp/js/picker.js` — home picker; fetches `/products/index.json` and renders the "Buying guides" section (cards link to `/products/<id>.html`).
