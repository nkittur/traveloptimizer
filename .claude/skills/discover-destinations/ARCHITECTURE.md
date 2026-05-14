# discover-destinations — Architecture

A snapshot of the system as it stands at end of the August 2026 trip build. Read this before extending the skill or porting the patterns to other trip types.

---

## 1. Purpose

`discover-destinations` is the top-level vacation planner that answers **"where should we go and why"** — one level up from `discover-restaurants` (which answers "where should we eat in city X"). It outputs a published-feeling page at `/?t=<token>` containing a ranked, climate-banded list of destinations, each with mention-driven cards for see-do / food / stay, a visual itinerary, source attribution, and operational data (flights, climate, loyalty perks).

The skill is sibling to `discover-restaurants` and `discover-activities`. It reuses the Playwright-MCP scrape discipline, Supabase storage, and the same webapp shell. The unit-of-work changes: a "destination" instead of a "restaurant."

---

## 2. The cardinal rule

**Every place name surfaced on the page must trace back to a real source — either a scraped article (verified) or curated training-knowledge (clearly labeled).** Mixing the two without labeling makes the system untrustworthy. The number of source badges and the structured data behind the cards must match: badges saying "5 sources verified" while cards show training-knowledge picks is the failure mode this skill exists to prevent.

This rule is enforced via:

- `sources: ['curated']` array on picks that aren't from a scrape — renders as a neutral "curated" pill, not a brand-color verified pill
- Source badges (NYT 36 Hours, T+L, etc.) only attach when the destination actually appears in that source's archive
- The mention-driven recomposer refuses to fabricate slot place_names: if mentions index has no candidate for a slot, the slot stays empty rather than being filled from training knowledge
- The `sources: [{ verified: true }]` flag is set only when the destination's name was seen in the scraped archive raw JSON

When the rule slips, it's almost always because something was hand-curated for expediency. Mark it.

---

## 3. The three-layer pipeline

The system is structurally **three layers**, not one. Every component fits into exactly one layer; mixing them is a smell.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Layer 1 — DATA ACQUISITION (scrape)                                 │
│  ──────────────────────────────────                                  │
│  · Source-archive mining (NYT 36 Hours archive, LP BIT, CNT, T+L,    │
│    AFAR) → which destinations exist for the trip                     │
│  · Per-destination article drill-in (NYT, NatGeo, T+L per-place)     │
│    → which named places exist within each destination                │
│  · Output: <source>-archive-raw.json, <slug>-<source>-raw.json       │
│  · Owned fields: place names, attribution, source URLs, raw snippets │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────────┐
│  Layer 2 — ENRICHMENT (operational)                                  │
│  ──────────────────────────────────                                  │
│  · Climate (Open-Meteo historical, free, no auth)                    │
│  · Flights (Google Flights via Playwright, 1-stop-only filter)       │
│  · PIT routing (curated nonstops list) — fallback                    │
│  · Photos (Google Places Text Search → photo media URL)              │
│  · Loyalty perks (curated mapping per destination)                   │
│  · Family-visit cooldown                                             │
│  · Output: trip_destinations.operational JSONB                       │
│  · Strict rule: never enrich during scrape; never scrape during      │
│    enrich. Layer separation is enforced by tool boundaries.          │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────────┐
│  Layer 3 — COMPOSITION (semantic)                                    │
│  ──────────────────────────────────                                  │
│  · Aggregate mentions across sources (cross-source counting)         │
│  · Pick top-N by category (sights, restaurants, hotels)              │
│  · Build agree_picks + food_picks + hotel_pick                       │
│  · Compose report_md (intro / natural / city / risks)                │
│  · Build itinerary slots from highest-mention places per type        │
│  · Output: report_md, itinerary, hotel_pick, agree_picks, food_picks │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────────┐
│  Render — webapp/js/trip.js                                          │
│  · Overview view: cards grouped by climate band                      │
│  · Detail view: hero / scorecard / picks / itinerary / report        │
└──────────────────────────────────────────────────────────────────────┘
```

The **key insight** that separates "trustworthy" from "decorative": badges (Layer 2 attribution) are cheap. The real depth comes from **per-destination drill-in** in Layer 1 — without that, badges are decorative because the picks driving the cards have no source. That distinction was the most consequential lesson of this build.

---

## 4. Components

### 4.1 Single source of truth — ghostwheel

Family preferences live ONLY in `../ghostwheel`. Do not introduce parallel preference stores in this repo:

- `../ghostwheel/data/people/{niki,carissa,ashi,robbie,jess}.md` — per-person profiles with `## Travel` and `## Food` sections
- `../ghostwheel/data/preferences/travel.md` — canonical for the family's travel preferences (climate, flights, vibes, recently-visited rules, loyalty cards, hotel cap, family-visit cooldowns)
- `../ghostwheel/data/preferences/food.md` — canonical for food

Loaded into tools via `tools/_load-travel-context.mjs` which reads ghostwheel and returns `{ family, friend_profiles, travel_md, food_md }`. Every tool that needs preferences uses this helper.

### 4.2 Supabase

**Tables** (migration `20260427000000_trips.sql`):

- `trips` — top-level trip rows with token, dates, origin, traveler_slugs, criteria, hard_filters
- `trip_destinations` — one row per candidate destination; the `operational` JSONB is the catch-all for enrichment data + state
- `trip_destination_photos` — photo metadata; storage_path points at Supabase Storage bucket `trip-photos`

**Storage bucket** `trip-photos`:

```
trip-photos/<trip-token>/<dest-slug>/
  hero-<hash>.jpg               — destination hero shots (Wikimedia / Google Places)
  itin-<slot-key>-<hash>.jpg    — itinerary slot photos (Google Places, googleMapsUri preserved as source_url)
  pick-<name>-<hash>.jpg        — see-do / food / stay card photos
```

### 4.3 CLI tools (organized by layer)

**Layer 1 — scrape:**
- Playwright MCP calls drive scraping interactively from the conversation; per-source `<slug>-<source>-raw.json` files are saved at the repo root
- `tools/_aggregate-aug2026-mentions.mjs` — turn raw scrape files into `<slug>-mentions.json`

**Layer 2 — enrichment:**
- `tools/enrich-trip-climate.mjs` — Open-Meteo historical data per lat/lng
- `tools/enrich-trip-flights.mjs` — PIT-nonstops list lookup (cheap pre-screen)
- `tools/enrich-trip-itinerary-photos.mjs` — Google Places photos per itinerary slot
- `tools/_fetch-card-pick-photos.mjs` — Google Places photos per see-do/food card pick
- `tools/_fetch-hero-photos-for-empty-dests.mjs` — fallback hero photo for destinations with no images

**Layer 3 — composition:**
- `tools/_recompose-aug2026.mjs` — reads `<slug>-mentions.json` → writes `report_md`, `itinerary`, `hotel_pick`, `agree_picks`, `food_picks`
- `tools/_score-aug2026.mjs` — applies scoring rubric, writes `composite_score`, `ranking`, `status='finalist'`, and operational.cooldown_status / operational.tagline
- `tools/_apply-aug2026-*.mjs` — one-off patches that override specific fields (hotel-picks, loyalty-perks, hyatt-filter, flight-data, rescrape-update, curated-picks, etc.). These accumulate as the system is iterated.

**Generic CLI:**
- `tools/create-trip.mjs`, `tools/get-trip.mjs`, `tools/upsert-trip-destinations.mjs`, `tools/mirror-trip-photos.mjs` — same pattern as the restaurants pipeline
- `tools/_load-travel-context.mjs` — ghostwheel → structured preferences
- `tools/_db.mjs` — shared Supabase REST helper (URL + anon key from `webapp/index.html`)

### 4.4 Webapp

Static SPA at `webapp/`. Three views, dispatched by URL params in `webapp/index.html`:

- `/?g=<token>` → `js/app.js` (restaurants — pre-existing)
- `/?t=<token>` → `js/trip.js` (overview)
- `/?t=<token>&d=<slug>` → `js/trip.js` (detail)
- `/` → `js/picker.js` (lists public groups + public trips)

`trip.js` handles routing internally via `pushState` + `popstate`. Browser back works.

---

## 5. Data model

### 5.1 trip_destinations columns

| Column | Purpose |
|---|---|
| `id`, `trip_id`, `slug`, `name`, `country`, `region` | identity |
| `lat`, `lng` | for Open-Meteo + Google geocoding |
| `status` | `candidate` / `active` / `finalist` / `rejected` / `removed` (snapshot semantics from upsert) |
| `ranking`, `composite_score` | filled by score script; ranking 1 = best |
| `scores` (JSONB) | per-bucket 0–5 (climate_fit, pit_accessibility, etc.) |
| `operational` (JSONB) | catch-all — see 5.2 |
| `sources` (JSONB array) | source attribution; entries have `{ type, url, title, verified, match }` |
| `report_md` | long-form markdown (intro, natural side, city side, risks) |
| `itinerary` (JSONB) | array of days; each has `slots` array with `{ key, type, label, place_name, text }` |
| `hotel_pick` (JSONB) | featured hotel: `{ name, neighborhood, approx_nightly_usd, summary, source_url, on_edit, on_hyatt }` |

### 5.2 operational JSONB shape

The most heavily-loaded field. Keys (all optional):

- `airport_codes: string[]` — IATA codes for the destination
- `tagline: string` — one-line "why" hook for overview cards
- `climate: { avg_high_F, avg_low_F, hottest_F, avg_precip_mm, rainy_days, region_risks, comfort, source }`
- `pit_routing: { status, airport_codes, nonstop_airports, seasonal, source, as_of }`
- `flight_estimate: { total_hours_door_to_door, round_trip_pp_usd, stops, sampled_window, quality, note, source }`
- `agree_picks: [{ name, category, count, sources, snippet }]` — see-do cards
- `food_picks: [{ name, category, count, sources, snippet }]` — food cards
- `loyalty_perks: { edit: [...], hyatt: [...], anchor, note, verify }`
- `recently_visited: { last_visited_iso, who, cooldown_months }`
- `cooldown_status: { penalty, reason, months_out, ok }`
- `family_present: string` — "cousin Stefi" / "parents (3-4x/year)"

### 5.3 trip_destination_photos columns

`trip_destination_id`, `storage_path`, `source_url` (used as click-through for cards), `caption`, `source_name`, `bucket` (one of: `hero` / `natural-beauty` / `city-aesthetic` / `foodie` / `boutique-stay` / `climate-feel` / `itinerary-slot`), `itinerary_slot_key` (for itinerary photos), `place_mentions` (array used by renderer to match cards to photos), `perceptual_hash`.

---

## 6. Key invariants

These are non-negotiable rules. Every change to the system must respect them.

### 6.1 Single source of truth = ghostwheel

Family preferences live in ghostwheel only. `traveloptimizer/profile/` was deleted. If a tool needs preferences, it uses `_load-travel-context.mjs`.

### 6.2 Scrape / enrich boundary

The scrape captures editorial content (place name, prose, source URL). The enrichment captures operational data (lat/lng, climate, flight prices, photos). **Never mix**: don't drill scrape sites for hours/prices (Google Places has them), don't use enrichment APIs for editorial content.

### 6.3 No 2-stop flights, ever

Per ghostwheel `travel.md` (2026-04-27): only nonstop or 1-stop are acceptable. If a destination requires 2+ stops, either re-route through an alternate airport with ground transport (Bergen → OSL + 50min hop, Asturias → BIO + 2h drive) OR mark `flight_estimate.quality='unviable'` and surface a warning.

### 6.4 Hotel budget cap = $500–600/night

Hotels above are excluded from recommendations unless: (a) Edit credit/discount brings the effective rate into the band, OR (b) bookable on Hyatt points. Above-cap hotels stay listed in a collapsed "above the cap" section with strikethrough pills, never the primary recommendation.

### 6.5 Hyatt dream-tier filter

Only mention dream-tier Hyatts: Park Hyatt, Alila, Miraval, famous resort Andaz (Maui, Costa Rica, Mayakoba), legendary Thompsons, Destination by Hyatt resorts. Skip: Hyatt Regency, Hyatt Place, Hyatt House, Hyatt Centric, urban Andaz, JdV unless iconic. Boring Hyatts at $250–400/night give the same point value but the destination doesn't earn its place on a recommendation list.

### 6.6 Family-visit cooldown

Parents 3-month cooldown between visits, cousins/aunts-uncles/siblings/friends 6-month cooldown. Recently visited = soft demotion (linear ramp from −0.6 at "last week" to 0 at the threshold), not hard exclusion. Pure-discovery places (Seattle, London) are still hard-excluded.

### 6.7 Climate band is wide

Sweet spot is 65–84°F, not 65–78°F. Up to 88°F OK with explicit cool-down mitigation (beach, pool, lake). Below 65°F is workable but "dressing for cold rather than enjoying summer."

### 6.8 Recently-visited is nuanced

Family-rich revisits (SF, San Diego, Irvine, Madison, etc.) are soft-demoted, not excluded. Pure-discovery (Seattle, London) are excluded. Both rules respect the cooldown above.

---

## 7. Composition discipline

What we say in the report and on the cards must trace back to scraped data when claimed as such.

### 7.1 Mention-driven, not training-driven

Every place name in `agree_picks`, `food_picks`, `hotel_pick`, and `itinerary[].slots[].place_name` must come from `<destination-slug>-mentions.json` (which itself came from a scraped raw JSON). If composition wants a place not in mentions, that's a sign the scrape missed something — re-scrape, don't fabricate.

### 7.2 Honest curated labeling

When training-knowledge content is used (because a destination has no scrapable per-place article), every pick gets `sources: ['curated']`. The renderer shows these as a neutral "curated" pill rather than a brand-color verified pill. Future scrapes can replace curated with verified.

### 7.3 Cross-source mention counting

Mention `count` and `sources` arrays on each pick reflect cross-source frequency. Currently most destinations have a single source (NYT 36 Hours), so `count: 1`. The structure is ready for true cross-counting once more sources are drilled per destination.

### 7.4 Report sections as cards, not paragraphs

The "What every source agrees on" markdown bullet section is dead. Replaced by `agree_picks` rendered as visual cards. Same for "The food side" (now `food_picks` cards) and "Where to stay" (now `hotel_pick` featured card). The report_md retains only intro + natural side + city side + risks paragraphs.

### 7.5 Thin-scrape guard

The recomposer skips destinations with <5 mentions in the aggregated file ("thin scrape — keeping existing composition"). This preserves curated content when a scrape returns noise (paywall, bad markup) instead of overwriting with garbage.

---

## 8. UX patterns

### 8.1 Climate-banded sections

Three sections: ☀️ Sweet spot (70–84°F), 🌊 Warm — needs cool-down (84°F+), ❄️ Cool side (<70°F). Within each, all destinations are visible (no "show more" button — those got missed). Section order: sweet → warm → cool.

### 8.2 Overview card

Compact card with hero image, rank pill, score, climate badge, flight badge, optional cooldown badge, optional loyalty badge (Edit/Hyatt count + ⭐ for trip-anchor candidates), tagline, source badges, "View details →" cue.

Solid-color badges (not 8%-opacity tints): green for nonstop / in-budget, coastal-blue for climate / 1-stop / mid-tier, terracotta for unviable / over-budget / questionable, orange for cooldown.

### 8.3 Detail page layout

Top-down on each finalist:
1. Header (rank, score, name, country, climate + flight meta)
2. Source badges
3. Loyalty perks block (with collapsed "above the cap" expander for over-budget hotels)
4. Hero masonry
5. Scorecard (compact: bucket | bar | score | fact)
6. **The place** — intro paragraph
7. **What to see + do** — card grid (sights/museums/parks/landmarks/shops)
8. **The natural side** + **The city side** — paragraphs
9. **Food** — card grid (restaurants/cafes/bars)
10. **Where to stay** — featured card (full-width, image + dark gradient + title/$/loyalty pills + summary)
11. Sample itinerary (per-day grid of two-part slot cards)
12. **Risks / tradeoffs** — paragraph
13. Source list (collapsed details with verification ticks)

### 8.4 Two-part slot cards

Itinerary cards: image at top (130px fixed), body at bottom. Body uses CSS grid `grid-template-rows: 16px 36px 1fr` so eyebrow / title / body align across all cards in a row. No clamping on body text — let cards grow, grid stretches siblings to match. Whole card is `<a>` to Google Maps URL.

### 8.5 Pick cards (see-do / food / stay)

Image-as-background with dark gradient bottom. Title + snippet sit on the dark band. Click → Google Maps. Featured stay card is full-width and taller. Cards in a grid auto-size by content (via grid stretching).

### 8.6 Tag pills in markdown

Inline `[#tag]` syntax in markdown renders as colored pills via the simple `inline()` regex extension in `md()`. Categories color-coded (museum slate, park green, restaurant terracotta, bar purple, hotel orange).

### 8.7 Scorecard

Compact grid layout (180px label | bar | score | fact). No image column (was redundant with the bucket icons). Each row's bar is a horizontal gradient fill 0-5.

### 8.8 Routing

`?t=<token>` overview. `?t=<token>&d=<slug>` detail. `pushState` on card click; `popstate` re-renders. Direct-URL load works (deep linking).

### 8.9 Hover states

- Overview cards: lift on hover (`translateY(-3px)`) + shadow bump
- Pick cards: same lift; card body link goes to Google Maps
- Itinerary slot cards: same; whole card is link

---

## 9. External dependencies

| Service | Used for | Auth | Reliability |
|---|---|---|---|
| Playwright MCP | Scraping editorial articles | None for public, NYT for paywalled archives | Generally good; older NYT 36 Hours articles (pre-2018) need login |
| Google Places API (v1) | Photos, place metadata, googleMapsUri | API key in `.env` | Reliable; rate-limited but generous |
| Google Flights | Round-trip price + duration | None (Playwright scrape) | Moderate — ad-hoc selectors break occasionally; "shortest in budget within 1.5x cheapest" rule was the breakthrough |
| Open-Meteo Historical Weather | Climate normals | None | Excellent (free, no key) |
| Wikipedia / Wikimedia | Hero photos for new destinations | None (must use proper User-Agent + retry on 429) | Good with backoff |
| Supabase | Storage + Postgres | Service-role key in `.env`, anon key public | Excellent |
| Vercel | Webapp hosting | CLI auth | Excellent |

---

## 10. Known gaps / future work

- **Per-source per-destination URL discovery is manual.** NYT has an archive listing; CNT/AFAR/T+L/LP don't. Finding the right per-destination article URL for each non-NYT source requires a Google search + judgment call. A general "find best article for this destination on this source" subroutine would scale better.
- **Older NYT 36 Hours articles need login.** Articles pre-2018 use the older article format and are paywalled. The user's NYT login session works but doesn't persist across browser closes. A persistent Playwright profile would solve this.
- **Aggregator's category inference is keyword-based.** It mis-classifies some places ("Take a dip." gets parsed as a bar because "dip" matches dive/bar keywords). A small per-pick override map per destination handles edge cases, but a smarter classifier (LLM-driven, or trained on the labels) would scale better.
- **Hand-curated data is honest but thin.** 7 of 22 destinations still use curated agree/food picks (Asturias, Azores, Banff didn't return scrape data, Halifax/Bergen/Irvine/Magdalen had no available articles). Expanding the source-coverage map would replace curated with verified.
- **Scoring rubric is hand-tuned.** The weights (climate_fit 2.0, pit_accessibility 1.0, etc.) were derived from family-preference judgment, not data. A "did the family enjoy this trip?" feedback loop would let weights self-calibrate over multiple trips.
- **Hotel pricing is point-in-time.** Hotel `approx_nightly_usd` is hand-curated based on typical August rates; doesn't refresh. Could integrate with Tablet Hotels / Mr & Mrs Smith for live pricing.
- **No mobile app.** The webapp is responsive and works on phones, but a PWA install + offline support would be nice for in-trip use.

---

## 11. How to extend the system

### Adding a new finalist mid-trip

1. `node tools/upsert-trip-destinations.mjs <trip-id> < new-candidate.json`
2. `node tools/enrich-trip-climate.mjs <trip-id>` and `enrich-trip-flights.mjs`
3. Re-run `_score-aug2026.mjs` (or build a generic `_score-trip.mjs` for non-Aug-2026 trips)
4. Scrape per-destination articles via Playwright MCP (save as `<slug>-<source>-raw.json`)
5. `node tools/_aggregate-aug2026-mentions.mjs` then `_recompose-aug2026.mjs`
6. `node tools/_fetch-card-pick-photos.mjs <trip-id>` for any new cards
7. Deploy webapp (no schema change needed)

### Adapting to a new trip (e.g., Spring 2027)

The current scoring/recompose scripts are named `*-aug2026-*` because they encode trip-specific dates and rubrics. For a new trip:

1. Generalize the scoring + recompose scripts to take dates as args (or refactor into `tools/score-trip.mjs` / `tools/recompose-trip.mjs`)
2. Update ghostwheel `travel.md` if family preferences have shifted
3. Run the generalized pipeline against the new trip token

### Adding a new source

1. Identify the source's article structure (per-destination article URL pattern, place-name markup)
2. Write a Playwright scrape recipe (extending the bold-text + section-walking pattern in existing scrapes)
3. Add the source's display name + brand color to `SOURCE_BADGES` in `webapp/js/trip.js`
4. Update the aggregator's filename regex if needed (currently accepts any single-token source name)
5. Add source-matching rules to the merger (`tools/_merge-aug2026-sources.mjs`)

---

## 12. Related documents

- `SKILL.md` — operational how-to for running the skill (read first)
- `LESSONS.md` — chronological/topical log of mistakes and fixes (read second)
- `../discover-restaurants/SKILL.md` — sibling skill, shares scrape discipline
- `../discover-activities/SKILL.md` — sibling
- `../../../CLAUDE.md` — repo-level intro
- `../../../webapp/supabase/migrations/20260427000000_trips.sql` — schema source of truth
- `../../../../ghostwheel/data/preferences/travel.md` — canonical preferences
