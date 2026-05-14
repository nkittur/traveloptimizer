# discover-destinations — Lessons learned

Indexed log of mistakes made and fixes applied during the August 2026 build. Each entry: what happened / root cause / consequence / skill mitigation. Read before extending — these are the dragons.

Topical, not chronological. Within each topic, lessons roughly follow the order they emerged.

---

## A. Data acquisition (scraping)

### A1 — Source-archive listing is cheap; per-destination drill-in is the value

**What happened.** First version mined NYT/LP/CNT/AFAR/T+L for *which destinations exist for the trip* (cheap, fast). The page proudly showed "5 sources verified" badges. But the cards (food, see-do, hotel) were filled with my training-knowledge picks, not source-derived data.

**Root cause.** Two-different-jobs were collapsed into one. Source-archive mining answers "is this destination on a credible list?" — it doesn't tell you what to do *inside* the destination. That requires drilling into the source's per-destination article. Skipping the second step makes the badges decorative.

**Consequence.** User called it out directly: *"are you weighting and recommending things in the summaries and itineraries that are mentioned by multiple sources?"* — Answer was no. Forced a structural rework.

**Skill mitigation.** SKILL.md now mandates Step 9 ("Drill into finalists' source articles"). Composition step 10 explicitly forbids fabricating slot place_names ("If composition wants to add a place not in the mentions index, that's a sign the article scrape missed something — go back and re-scrape rather than fabricate"). The new failure mode is in the failure-modes table: "Source badges say 5 sources verified but the report's place picks read like generic training-knowledge → skipped Step 9".

### A2 — Curated content needs honest labeling

**What happened.** When per-destination articles weren't available (Asturias, Azores, Banff, Halifax, Bergen, Irvine), I hand-curated agree_picks / food_picks from training knowledge. Initially the renderer treated these the same as scraped picks — same source pills, same visual treatment.

**Root cause.** Mixing verified and curated data without distinction violates the cardinal rule of the system.

**Fix.** Curated picks now get `sources: ['curated']`. Renderer shows them with a neutral-grey "curated" pill rather than a brand-color verified pill (NYT, T+L, etc.). Future scrapes can replace curated with verified.

### A3 — Older NYT 36 Hours articles need login

**What happened.** The NYT 36 Hours archive page lists 180+ articles spanning ~3.5 years. Recent ones (2022+) are interactive-format and scrape cleanly without auth. Older ones (2011 Bar Harbor, 2016 Halifax, etc.) are article-format and behind the paywall.

**Root cause.** NYT archive policy. Login session unlocks them but doesn't persist across Playwright browser closes (no profile reuse).

**Fix.** Ask user to log in via the visible Playwright window, then immediately scrape all paywalled articles in one session before closing. For session-spanning use, a persistent Playwright profile dir would help.

### A4 — Multiple bold-text patterns per source

**What happened.** Initial extractor used a single pattern (`p strong, p b, li strong, li b`). Worked for NYT 36 Hours interactive (each place is bolded inside a description paragraph). Failed for older NYT format (numbered ALL-CAPS headings followed by descriptions). Returned 3 noise items for the 2011 Bar Harbor article.

**Root cause.** Extractors are coupled to source layout. One pattern per source format.

**Fix.** Per-source extractor scripts with fallback logic. NatGeo + T+L use h2/h3 + bold-in-paragraph patterns; older NYT uses numbered-heading patterns. The recomposer's "thin-scrape guard" (skip if <5 mentions) protects against bad extractor output corrupting the destination.

### A5 — Aggregator regex was too narrow

**What happened.** Aggregator filename regex required source token to be one of `nyt36hours|cntraveler|afar|lonelyplanet|tl[a-z0-9]+`. When I added `acadia-maine-natgeo-raw.json` and `acadia-maine-tl-raw.json`, both got silently filtered out. Acadia mentions returned 0.

**Root cause.** Allowlist regex doesn't scale. Should be permissive (any single-token source) plus blocklist for known non-source files.

**Fix.** Now: `^[a-z][a-z0-9-]+-[a-z][a-z0-9]+(-[a-z0-9]+)?-raw\.json$` with explicit excludes for archive/bestof/snapshot/reddit files. New sources work without code changes.

### A6 — Per-source per-destination URL discovery is manual

**What happened.** NYT 36 Hours has a clean archive at `/column/36-hours` listing every article. CNT, AFAR, T+L, LP do not — finding their per-destination article requires Google search + judgment per destination.

**Root cause.** Different publishers, different content models. NYT's column structure is rare.

**Fix.** Document the search pattern in SKILL.md (`site:travelandleisure.com <destination> guide`). For now, manual; eventually a "find the canonical article on this source for this destination" subroutine would help.

---

## B. Filtering / noise

### B1 — Bold-text extraction picks up sentence fragments

**What happened.** Lisbon's top-mention place was *"following a fatal crash"* — a fragment from a sentence about funicular trams being closed.

**Root cause.** Bold-text scraping captures any `<strong>`/`<b>` content, including non-place phrases.

**Fix.** Aggregator now filters: phrases starting lowercase, sentence-fragment patterns (`/^(note that|please|don't|...|following)\b/`), trailing punctuation, >8 words, non-letter content. Drops ~20% of raw extractor output but keeps the genuine place names.

### B2 — Mention category inference is keyword-based

**What happened.** Acadia's top-5 mentions categorized "Take a dip." as `bar` (because "dip" matched a beverage-related keyword). NatGeo's article uses "Take a dip" as a section header.

**Root cause.** Naive keyword classifier.

**Fix.** Tighten keywords; add per-destination skip-list for known false positives. A smarter classifier (LLM-driven, or trained) would scale better but is overkill for v1.

### B3 — Same image used across multiple bucket/slot combos was being deduped

**What happened.** Photo dedupe was hash-only, so the same Wikipedia photo of "Cadillac Mountain" couldn't be both a hero and a 2-morning itinerary slot photo — second use got dropped.

**Root cause.** Dedup key was just `hash`, not `(dest_id, bucket, slot_key, hash)`.

**Fix.** mirror-trip-photos.mjs dedup key is now `${dest_id}|${bucket}|${slot_key}|${hash}`. Same image legitimately appears in multiple buckets/slots without being dropped.

### B4 — Wikimedia rate-limits scrapers without identifying User-Agent

**What happened.** Bulk download of 99 Wikipedia images returned `429` for most of them.

**Root cause.** Default fetch User-Agent is generic; Wikimedia is strict.

**Fix.** Set `User-Agent: traveloptimizer/1.0 (https://github.com/...; <email>) Node/22`. Add exponential-backoff retry (0.6s, 1.2s, 2.4s, 4.8s). Polite 220ms delay between downloads.

---

## C. Scoring & ranking

### C1 — Climate band was too narrow

**What happened.** Sweet spot was 65–78°F. Excluded Lisbon (85°F), Costa Brava (86°F), and several otherwise-strong destinations. Reykjavík (56°F) ranked top despite being objectively chilly.

**Root cause.** Initial encoding of family preferences was conservative.

**Fix.** User explicitly relaxed in two phases. Final: 65–84°F sweet, up to 88°F OK with mitigation, <65°F workable but "dressing for cold." Encoded in ghostwheel `travel.md` and reflected in `scoreClimate()` rubric.

### C2 — Direct-flight-only constraint was too strict

**What happened.** Carissa's "strong direct-flight preference" caused the scoring to penalize 1-stop flights heavily (`pit_accessibility` weight 1.5). Limited the candidate pool drastically.

**Root cause.** Misencoded preference. The actual preference is total door-to-door time vs. trip length, not nonstop-vs-1-stop binary.

**Fix.** Weight reduced 1.5 → 1.0. Rubric softened: 1-stop with sane layover is now 4.0 (was 3.0). Encoded in ghostwheel "What matters is total door-to-door time vs. trip length, not nonstop-vs-1-stop per se."

### C3 — Recently-visited shouldn't be a hard exclusion

**What happened.** Original `exclude_recently_visited` filter dropped SF, San Diego, Irvine, Madison entirely — but the family wants to revisit family-rich places.

**Root cause.** Binary filter doesn't capture the nuance of "we want to see them but not back-to-back."

**Fix.** Family-visit cooldown rule: parents 3 months, cousins/siblings/friends 6 months. Linear-ramp soft demotion (max −0.6 at "saw last week", 0 at threshold). Pure-discovery places (Seattle, London) still hard-excluded. Ranked SD dropped from #5 → #15 after Stefi visit was tagged.

### C4 — 2-stop flights are unacceptable, period

**What happened.** Initial Google Flights scrape extracted "shortest within 1.5x cheapest" — sometimes returned 2-stop routings as the recommendation.

**Root cause.** No stops filter on the extractor.

**Fix.** Extractor now drops anything `>= 2 stop`. For destinations with no 1-stop available (Bergen direct, Magdalen, Asturias OVD), re-route through alternate airport with ground transport (OSL+50min, BIO+2h drive) OR mark `flight_estimate.quality='unviable'` and surface a warning. Encoded in ghostwheel and SKILL.md.

### C5 — Top-N cap was vestigial

**What happened.** Original recompose set `topN = 6`, then 9, then I kept patching it. Always picked too few.

**Root cause.** "Top-N as finalists" was a holdover from when the page only showed finalists. The new layout shows everything banded by climate.

**Fix.** `topN = scored.length` — every scored destination is a finalist. Renderer handles ranking visually.

---

## D. Composition

### D1 — Auto-pick of `hotel_pick` from mentions can be wrong

**What happened.** Recomposer picked "Orient" (a town on Long Island) as Hamptons' hotel_pick because it had the highest count in the `category=hotel` partition.

**Root cause.** Category inference put "Orient" in the hotel bucket because the snippet talked about the historical district. Recomposer trusted the inference.

**Fix.** Per-destination `hotel_pick` overrides via `_apply-aug2026-hotel-picks.mjs`. The override is opinionated: in-budget rooms, with `approx_nightly_usd`, neighborhood, summary, source URL, on_edit/on_hyatt flags. Auto-pick remains as a fallback for destinations where the override isn't set.

### D2 — Recompose snapshot semantics nuked active candidates

**What happened.** I ran `upsert-trip-destinations` with just the 6 finalists in the input. Snapshot semantics marked all 12 other destinations as `removed`. They disappeared from the page.

**Root cause.** Upsert is snapshot-mode by design (matches discover-restaurants pattern); partial input = "everything else is removed."

**Fix.** Two patterns: (a) when partial-input is intentional, follow up with a direct PATCH to restore status on the others; (b) prefer using direct PATCH for single-destination updates rather than running upsert with partial input. Most one-off scripts (`_apply-aug2026-*.mjs`) now use PATCH.

### D3 — Inline italic-paren tags read poorly

**What happened.** "What every source agrees on" bullets initially rendered as `**World of Words** _(museum, 1× nyt36hours)_ — description...`. Italic parens inline with prose looked noisy.

**Root cause.** Markdown is fine for prose but bad for typed metadata.

**Fix.** Replaced with `[#tag]` syntax. Markdown renderer recognizes the pattern and emits colored pill spans. Recomposer emits `[#museum] [#NYT 36 Hours]` after the place name. Cards eventually superseded the markdown bullets entirely.

### D4 — Markdown bullets vs. card grids — pick one

**What happened.** Initial layout had "What every source agrees on" / "Food side" / "Where to stay" as markdown bullet sections. Then we added card grids for the same content. For a while, both rendered (duplication).

**Root cause.** Migration in progress.

**Fix.** Recomposer strips the bullet sections from `report_md` for destinations with structured `agree_picks`/`food_picks`. The markdown report retains only intro, natural side, city side, risks. Card grids own the see-do/food/stay rendering.

### D5 — Curated v1 finalists have markdown bullets that aren't replaced by cards

**What happened.** The original 5 v1 finalists (Acadia, Copenhagen, Quebec, Reykjavik, Vancouver, Stockholm) had hand-written markdown reports including "What every source agrees on" bullet sections. When the migration to cards happened, those reports retained the markdown sections (since the v1 content was preserved).

**Root cause.** Migration only rewrites destinations that go through the recompose pipeline.

**Fix.** Renderer detects "have structured picks" — if yes, skip the corresponding markdown section in fallback. If no (curated v1), let the markdown render as-is. Future cleanup: convert v1 curated reports to structured data for visual consistency.

### D6 — Thin-scrape guard preserves curated content

**What happened.** Bar Harbor 2011 NYT scrape returned only 3 hotel mentions (paywall + older format). Without protection, the recomposer would have overwritten Acadia's good v1 curated content with 3-place hotel-only data.

**Fix.** Recomposer now: `if (mentionsData.mentions.length < 5) skip with "thin scrape, keeping existing composition"`. Preserves v1 quality when scrape data is bad.

---

## E. Photos

### E1 — Hero photos for new destinations needed a fallback fetcher

**What happened.** When I added 7 new candidates mid-trip, none had photos at all. Cards rendered with placeholder gradients.

**Root cause.** No automated path for "fetch a single hero photo for any destination."

**Fix.** `_fetch-hero-photos-for-empty-dests.mjs` — for any destination with 0 photos, query Google Places by destination name, fetch first photo, upload as `bucket='hero'`. Run after adding new candidates.

### E2 — Place→photo lookup is cross-bucket

**What happened.** Card photos for see-do / food / stay aren't stored in dedicated buckets — they reuse `natural-beauty` / `foodie` / `boutique-stay` per the pick's category.

**Root cause.** Schema constraint: `bucket` is an enum from a fixed list. Adding a new "card-pick" bucket would require migration.

**Fix.** Renderer's `findPhotoForPlace()` searches across ALL buckets and matches via `place_mentions` array (or caption substring as fallback). Bucket assignment becomes a categorization signal, not a lookup primary key.

### E3 — Same Google Flights URL gives different prices on retries

**What happened.** Two scrapes of the same PIT→VCE Aug 1-8 query returned different prices ($1092 first, $1079 second). Could be Google A/B testing, regional variation, or temporal price changes.

**Root cause.** Live pricing is non-deterministic.

**Fix.** Multi-window sampling (Aug 1-8, 8-15, 15-22) with min taken. The "shortest within 1.5x cheapest" rule reduces sensitivity to single-query noise. Also added a "verify on Google Flights before booking" caveat in every flight_estimate's note.

---

## F. Loyalty / hotels

### F1 — Hotel budget cap is non-negotiable

**What happened.** Initial hotel picks included Topping Rose House Hamptons ($1800/night), Wickaninnish Inn Tofino ($1400), Ett Hem Stockholm ($950) — all dream-grade but well above family means.

**Root cause.** Hotels were picked for editorial fit, not budget fit.

**Fix.** Encoded $500-600/night cap in ghostwheel `travel.md`. Loyalty perks list now flags each hotel as `in_budget` / `edit_brings_in` / `points_only` / `over_budget`. Renderer collapses over-budget hotels behind an expander with strikethrough pills.

### F2 — Boring Hyatts dilute the loyalty signal

**What happened.** Initial loyalty-perks list included Hyatt Regency Vancouver / Lisbon / Newport Beach, urban Andaz, JdV — basically every Hyatt brand with a property in each destination. Made the loyalty signal noisy.

**Root cause.** "Hyatt" was treated monolithically.

**Fix.** Dream-tier filter: only Park Hyatt, Alila, Miraval, famous resort Andaz (Maui, Costa Rica, Mayakoba), legendary Thompsons, Destination by Hyatt resorts. Boring chains removed. Encoded in ghostwheel — "Boring Hyatts at $250-400/night give the same point value but the destination doesn't earn its place on a recommendation list."

### F3 — Edit credit is per-stay, not per-night (mostly)

**What happened.** Initial wording said "$100/night credit" — actually it's $100 per stay (or per booking) for most CSR Edit benefits at the time of writing.

**Fix.** Documented as "$100/stay credit + breakfast" in ghostwheel and the renderer's loyalty section. Always link to chase.com/travel/the-edit for verification — programs change.

---

## G. Family preferences

### G1 — Single source of truth = ghostwheel

**What happened.** Initial design had `traveloptimizer/profile/family.json` as the local preferences file. User asked to consolidate: *"i'd rather not have things in two places."*

**Fix.** Migrated all family.json content to ghostwheel (`data/people/*.md` + `data/preferences/{travel,food}.md`). Deleted `profile/` entirely. Tools load via `_load-travel-context.mjs` which reads ghostwheel.

### G2 — Family visit cooldown isn't binary

**What happened.** First version used a binary `exclude_recently_visited` filter. User pointed out: SD, Irvine, Madison have family — they want to visit again, just not back-to-back.

**Fix.** Cooldown rule with ramps. Parents 3 months, cousins/siblings/friends 6 months. Soft demotion linearly ramps from −0.6 (saw last week) to 0 (saw exactly cooldown ago). Past cooldown → no penalty.

### G3 — Climate cap should be wider

**What happened.** Initial climate sweet spot 65–78°F was the user's earlier framing. Multiple iterations over the build:
1. 65–78°F (initial) — too narrow, eliminated Lisbon, Costa Brava, several Mediterranean options
2. 65–82°F (first relaxation)
3. 65–84°F (second relaxation, current) — sweet spot widened to capture summer warm-coast destinations

**Fix.** Final encoding: 65–84°F sweet, 84–88°F OK with mitigation (beach/pool/lake), <65°F workable but "dressing for cold." Cooler spots like Reykjavík (56°F) still rank but lose climate points.

---

## H. UX patterns

### H1 — Pagination behind a "Show all" button gets missed

**What happened.** Initial overview had `INITIAL_PER_BAND = 6` with a "Show all 14 sweet-spot destinations →" button below. User asked where Banff was — couldn't find it because it was hidden behind the expander.

**Root cause.** "Show more" patterns work for archives, not for "see your trip options." The user wants to see all options.

**Fix.** `INITIAL_PER_BAND = 999`. Show everything. The grid layout handles vertical real estate gracefully.

### H2 — 8%-opacity tinted badges are unreadable

**What happened.** Climate + flight badges used `rgba(31,93,138,0.08)` backgrounds with brand-colored text. User: *"its hard to read the temperature and airline tags, make them have more contrast."*

**Fix.** Solid colors with white text. Coastal blue for default/climate, green for nonstop, terracotta for unviable/warn, orange for cooldown. WCAG-grade contrast.

### H3 — Image-as-background-with-overlay is hard to read

**What happened.** Itinerary cards initially had image-as-background + dark scrim + white-text-overlay. The hover-fade-text-show-image-with-pill interaction was clever but readability was poor.

**Fix.** Two-part cards: image at top (130px fixed), white card body below with dark text. Whole card is a click target. Way more scannable.

### H4 — Card titles need vertical alignment for scannability

**What happened.** When card body text was variable-length, titles ended up at different vertical positions across cards in a row. Eyes had to jump.

**Fix.** CSS Grid with fixed row heights for eyebrow (16px) and title (36px = 2-line allowance). Titles align across the row regardless of body content.

### H5 — Don't truncate body text — let cards stretch

**What happened.** Initial cards had `-webkit-line-clamp: 4` on body text. Users couldn't read full snippets without clicking.

**Fix.** Removed the clamp. CSS Grid auto-stretches all cards in a row to match the tallest. Title alignment is preserved by the fixed-height title row.

### H6 — Climate-banded sections are the right organizing principle

**What happened.** Earlier versions just sorted by composite_score. User asked to break into "cooler / warmer" sections.

**Fix.** Three bands: Sweet (70–84°F) / Warm (84+) / Cool (<70). Each section has its own header, icon, and description. Within a section, ordered by ranking.

### H7 — Featured stay card vs. inline card grid

**What happened.** Initially the hotel pick was rendered the same way as see-do/food cards (one of N in a grid). Hotel deserves more prominence.

**Fix.** Featured card style: full-width single card, taller (380px), bigger title, more body text room. Differentiates it from the see-do/food cards visually.

### H8 — Tag pills in markdown via inline syntax

**What happened.** Trying to render tags in markdown — initially wrote `_(museum, 1× nyt36hours)_`. Looked terrible.

**Fix.** New `[#tag]` syntax. Markdown renderer extends `inline()` with regex `/\[#([^\]]+)\]/g` → emits `<span class="md-tag md-tag-cat md-tag-museum">museum</span>`. Categories color-coded. Source tags use neutral grey.

### H9 — Routing via pushState + popstate

**What happened.** Need to navigate between overview and detail without page reloads. Need browser-back to work. Need direct-URL load to render the right view.

**Fix.** `?t=<token>` overview, `?t=<token>&d=<slug>` detail. `history.pushState` on card click; `popstate` listener re-renders. `load()` function reads URL on initial mount and dispatches accordingly.

### H10 — Itinerary text hidden by hover overlay was a clever-but-bad pattern

**What happened.** Itinerary cards initially had: image-bg with text overlay, hover → text fades, image clear, "View on Maps →" pill appears. Clever but two states meant users sometimes needed to hover to read fully.

**Fix.** Replaced with two-part static layout. Whole card is the link. Removed the hover-fade interaction.

---

## I. Operational data

### I1 — Google Flights "shortest within 1.5x cheapest" was a key insight

**What happened.** Naive "cheapest flight" extractor returned slow long-layover routes. Naive "shortest flight" returned premium-cabin prices.

**Fix.** Compute cheapest, then filter to flights ≤ 1.5x that price, then take shortest of those. Captures the "fast-enough at sane price" sweet spot. Drops 2-stop options entirely (per family rule).

### I2 — Per-destination flight quality varies

**What happened.** For some destinations Google returned only one option, or only multi-stop options, or weird routings (PIT→PVD with 7h connection when nonstop ~1.5h exists at $300). Single-snapshot scraping is noisy.

**Fix.** Each `flight_estimate` has a `quality` field: `good` / `questionable` / `unviable`. The renderer shows ⚠ on questionable badges. The note explains the caveat. User can verify on Google Flights themselves.

### I3 — Magdalen Islands genuinely require 2+ stops

**What happened.** PIT→YGR (Magdalen Islands) has no 1-stop option in the searched dates. Per the no-2-stop rule, the destination is unviable.

**Fix.** Marked `flight_estimate.quality='unviable'`. Renderer shows "✈ 2+ stops · unavailable" badge. Destination stays on the page (user can see it was considered) but the constraint is clearly visible.

---

## J. Architecture & data

### J1 — `operational` JSONB is a catch-all and that's fine

**What happened.** `operational` accumulated many sub-keys: airport_codes, climate, pit_routing, flight_estimate, agree_picks, food_picks, loyalty_perks, recently_visited, cooldown_status, family_present, tagline.

**Root cause.** Keep it consolidated rather than scatter across columns. JSONB is flexible and matches the "this is a destination's annotated metadata" mental model.

**Fix.** No fix needed — this is the right pattern. Document the shape (in ARCHITECTURE.md §5.2) and treat it as the catch-all.

### J2 — Per-destination override scripts accumulate

**What happened.** Every iteration produces a `tools/_apply-aug2026-*.mjs` script. By end of build there were ~10 of them.

**Root cause.** The user iterates fast; each iteration changes specific fields. Easier to write a focused one-off than to generalize.

**Fix.** Accept the proliferation; each script is small and self-contained. For long-term maintenance, a small set of generalized helpers (`patch-trip-destinations.mjs <trip-id> --field <path> --value <json> --where <slug>`) would replace the ad-hoc scripts.

### J3 — Trip-token URLs are publicly viewable

**What happened.** `?t=<token>` is shareable. The 8-char token is unguessable, but the trip page is public.

**Implication.** Don't put sensitive data on trip pages. Family names + destination preferences are intentionally surfaced. Hotel pricing is approximate. Trip dates / origin / family-rich-revisit notes are visible.

**Fix.** No fix; this is by design. The token serves as access control. Don't add private content (unredacted contact info, payment data) to trip pages.

---

## K. Process

### K1 — Iterate-while-building beats plan-then-build

**What happened.** Many small bugs surfaced only when the user saw the rendered page (price-cap not respected, boring Hyatts cluttering the list, badges hard to read, Banff missing behind a button). Building, deploying, getting feedback was the right cadence.

**Fix.** No fix. Embrace it. Keep iterations cheap (single deploy command, minimal review surface) and let user feedback drive the next change.

### K2 — Hand-curated v1 → mention-driven v2 migration is the natural arc

**What happened.** First version had hand-composed reports + itineraries for 6 destinations. Second wave added mention-driven recompose for 13 more. Then user pushed for real-source data on the curated ones.

**Fix.** Treat curated as the bootstrap; mention-driven is the target end state. Mark curated honestly so the migration path is visible in the data.

### K3 — Source-archive scraping is a quick win; per-destination drill-in is the real work

**What happened.** Scraping NYT 36 Hours archive (one page, 180 articles) took 5 minutes. Scraping 13 per-destination NYT articles took 15 minutes. Scraping 13 destinations × 3 sources = 39 articles for true cross-source counting would take ~1 hour. The work scales linearly with source-coverage demand.

**Implication.** Be honest about the scope of "do the full pipeline." Most of the time is per-destination article scraping; once the raw files exist, aggregation + recompose + rendering is fast.

---

## L. Open lessons / dragons remaining

These are known issues that haven't been fully addressed:

- **Banff NYT 2025 article scrape returned 0 places.** The interactive markup in that specific article doesn't fit the bold-text extractor. Needs a per-article extractor variant.
- **Aggregator's category inference has known false-positives** ("Take a dip." → bar). Per-destination skip-lists handle the worst; smarter classifier would help.
- **Some Edit hotel rates are seasonal/variable.** The ~$XXX/night estimates are point-in-time; programs and rates change. The "verify on chase.com" link is the safety valve.
- **Hand-curated picks for 6 destinations** (Asturias, Azores, Banff, Halifax, Bergen, Irvine) still need real source-mining. Fall-back is acceptable for v1 but the migration path is clear.
- **No automated test of the rendered page.** Visual regression would catch the "Banff is missing behind a button" class of issue earlier.
