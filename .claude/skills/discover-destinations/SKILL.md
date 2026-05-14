---
name: discover-destinations
description: Pick where to go for a vacation. Mines high-trust travel sources (NYT 36 Hours archive, CNT, AFAR, Lonely Planet, etc.) for candidate destinations, applies the family's hard filters from ghostwheel, scores survivors against weighted preference buckets (climate, natural beauty, city/aesthetic, foodie, boutique stays, PIT-accessibility), then composes long-form reports with visual scorecards, hero masonry, hotel pick, and a visual sample itinerary for the top 6–10. Writes everything to Supabase (trips/trip_destinations/trip_destination_photos) and renders at /?t=&lt;token&gt;. Triggered by "where should we go in &lt;month&gt;", "find vacation destinations for &lt;trip&gt;", "discover destinations for trip &lt;id&gt;", "plan our August trip", or similar.
user-invocable: true
argument-hint: "<trip-id> | <new trip name + dates>"
---

Pick destinations for a vacation. Sibling of `discover-restaurants` and `discover-activities` — same scrape-discipline and two-pass philosophy, but **one level up**: the unit of work is "which city" not "which place inside a city." Output is a per-trip ranked shortlist with visual scorecards, long-form reports, and visual itineraries — published to the same webapp as a `/?t=<token>` route.

**Read the sibling skills first** (`../discover-restaurants/SKILL.md`, `../discover-activities/SKILL.md`). This file documents the **destination-level differences**, not the shared scrape/normalize/compose discipline.

---

## Inputs

- **Either**: an existing 8-char trip token (`cg7pgj64`) — populate or refresh that trip.
- **Or**: a new trip request — name, dates, origin (default PIT), travelers (default `niki,carissa,ashi`), criteria. Create the trip first via `tools/create-trip.mjs`, capture the token, then proceed.

Always start by loading the family's travel context:

```bash
node tools/_load-travel-context.mjs niki carissa ashi
```

This pulls per-person travel/food sections from ghostwheel (`data/people/<slug>.md`) plus shared `data/preferences/{travel,food}.md`. The returned `travel_md` and `food_md` are the canonical preferences — read them before picking sources or designing scoring weights. **Do not write parallel preference stores in this repo.** If a preference is missing from ghostwheel, propose adding it to ghostwheel first.

---

## Preconditions

1. **Supabase reachable** — `webapp/index.html` has URL + anon key; `_db.mjs` reads them. `.env` has `SUPABASE_SERVICE_ROLE_KEY` for storage uploads.
2. **Playwright MCP available** — every editorial scrape goes through `mcp__playwright__browser_*`. Never WebFetch a JS-heavy site (NYT, CNT, AFAR, Lonely Planet, Atlas Obscura — all JS-render).
3. **Open-Meteo reachable** — `enrich-trip-climate.mjs` uses the free historical-weather API (no key).
4. **Trip exists** — created via `tools/create-trip.mjs`, returns the 8-char token.

---

## Pipeline order — two passes; mentions drive composition

This skill is **two passes**, structured around the same multi-source discipline as `discover-restaurants`. The key idea: **the same sources that justify a destination's selection also drive what's inside the destination's report and itinerary.** Cross-source mention counting weights everything.

```
 Pass 1 (gather + filter + score destinations):
   Step 1  Load trip + ghostwheel travel context
   Step 2  Pick sources — direct search + source-archive mining (city-level)
   Step 3  Scrape archive listings — extract destination NAMES + URLs only
           (one pass per source, save <source>-archive-raw.json)
   Step 4  Normalize + cross-source merge → upsert as 'candidate'
           (each candidate's sources[] populated with verified=true entries
            from every archive that contains it, including adjacent matches)
   Step 5  Hard filters (recently_visited, oppressive_heat-no-mitigation, no_pit_routing)
           → mark rejected with reason
   Step 6  Operational enrichment: airports, climate, optional flights detail
   Step 7  Score the survivors against weighted buckets
   Step 8  Pick top 6–10 → mark status='finalist' with ranking

 Pass 2 (drill into finalists' sources, then compose):
   Step 9    For each finalist, drill into EACH source's per-destination article
             → extract every named place (restaurant/sight/hotel/neighborhood)
               with its section + a 1-sentence snippet
             → save as <destination>-articles-raw.json
             → build mentions index: place → { count, sources, category, sections }
   Step 10   For each finalist:
              · Compose long-form report_md driven by mention counts —
                  the "What every source agrees on" section LISTS the highest-mention
                  places with their snippets, sorted by count
              · Compose visual itinerary slots picking from highest-mention places
                in the matching category (sights for morning/afternoon, restaurants
                for lunch/dinner, hotels for stay block)
              · Pick hotel = highest-mention "Where to stay" candidate
              · Bucket all collected images, link to itinerary slots, dedupe, upload
   Step 11   Re-upsert finalists with composition fields
   Step 12   Fetch Google Places photos for itinerary slot place_names
   Step 13   Verify webapp render at /?t=<token>
   Step 14   Report to user with the link
```

**Why the per-article drill-in is non-negotiable** (lesson from this skill's own history): if you skip Step 9 and compose reports/itineraries from your training-knowledge picks, the badges will say "5 sources verified" but the *contents* of the report won't actually reflect what those 5 sources said. The badges become decorative. Always do the second-pass drill-in for finalists.

---

## Step 1 — Load trip + travel context

```bash
node tools/get-trip.mjs <trip-id>            # constraints, hard_filters, travelers
node tools/_load-travel-context.mjs niki carissa ashi   # ghostwheel pull
```

Read both before picking sources. The trip's `criteria.freeText` and `hard_filters` define the search; ghostwheel's `travel_md` and per-person notes define the **why** behind the scoring weights.

---

## Step 2 — Pick sources (the source-archive mining innovation)

For destinations, **direct keyword search alone misses things you wouldn't think to search for.** The unique discipline here is **source-archive mining**: walk the index/column page of high-trust sources to harvest their full universe of covered destinations, then filter by trip constraints.

### Source-archive lists (mine these for unfamiliar candidates)

- **NYT 36 Hours** — `nytimes.com/column/36-hours`. The full archive of every 36-Hours destination NYT has covered. Each entry is a vetted, image-rich, journalist-written guide. **The single most valuable archive for North-American/European destinations.** Older article-format entries scrape cleanly; the 2021+ interactive format is paywalled — use the article-format ones.
- **NYT 52 Places to Go** — annual list (each year). Surfaces "year-of" picks you'd miss otherwise.
- **Condé Nast Traveler "Hot List" + "Readers' Choice Awards"** — annual destination lists; CNT galleries scrape cleanly via `window.__PRELOADED_STATE__`.
- **Travel + Leisure World's Best Awards** — annual best-cities/islands/destinations.
- **AFAR Wanderlist** — seasonal "where to go now" curated lists.
- **Lonely Planet "Best in Travel"** — annual top countries/cities/regions, with sub-categories ("Best for Families," "Best for Foodies," "Best for Sustainability") that align with the family's preferences.
- **NatGeo Traveler "Best of the World"** + **"Cool List"** — annual offbeat picks.
- **Atlas Obscura — `things-to-do/<region>`** — at the city level for hidden-gem flavor.

### Direct-search sources (for "fits this month + this kind of trip")

- **Google search**: `"where to travel in August" 2026`, `"best destinations early August"`, `"summer trip ideas family"`, `"cool destinations August" -hot -humid`.
- **r/travel** + **r/SuggestADestination** + **r/solotravel** + **r/Itineraries** — search for "August" + "family" + "from Pittsburgh" / "from US East Coast." Reddit catches niche destinations editorial misses.
- **Smarter Travel / Frommer's "Where to go in August"** — listicles done well.

### Source mining recipe

For each archive source:

1. Navigate to the archive index page.
2. Extract every destination + URL into a raw JSON: `<source>-archive-raw.json` at the repo root.
3. For unfamiliar destinations on the list, drill into the article and capture: name, country, hero text, hero image URL, and the named places-to-go/eat/stay/see (with their photos + captions). Save as `<source>-<destination>-raw.json`.

**Aim for 50–150 candidate destinations** in the raw pool. The hard filters in Step 5 will cut most of them.

### Rejection criteria for sources

- **SEO listicles** (TripAdvisor, Yelp, generic "top 10" blogs) — untrusted.
- **AI content farms** — no author bio, generic prose, boilerplate structure.
- **Stale archives** (>3 years old) unless historically definitive.

---

## Step 3 — Scrape with image+caption capture (the visual-scorecard prerequisite)

The discover-destinations scrape is structurally identical to the restaurants scrape, **except images and captions are first-class outputs** — they feed the visual scorecard, hero masonry, and visual itinerary.

### Per `<figure>`/`<img>` element, capture

```json
{
  "src": "https://image.cdn/...jpg",
  "caption": "The lobby at Memmo Alfama, a 42-room boutique in the old Moorish quarter",
  "alt": "Sun-lit lobby with terracotta tile",
  "section": "Where to Stay",          // closest preceding h2/h3 in the article
  "context_paragraph": "...",          // first paragraph of the surrounding section
  "place_mentions": ["Memmo Alfama"]   // named places that appear in caption (filled by normalizer)
}
```

`browser_evaluate` recipe (adapt per source):

```js
[...document.querySelectorAll('figure, img')].map(el => {
  const img = el.tagName === 'IMG' ? el : el.querySelector('img');
  if (!img?.src) return null;
  const cap = el.querySelector('figcaption')?.textContent?.trim()
           || img.getAttribute('alt')
           || el.nextElementSibling?.matches('p,em,small') ? el.nextElementSibling.textContent.trim() : null;
  // Walk back to the closest preceding h2/h3
  let n = el, section = null;
  while ((n = n.previousElementSibling || n.parentElement)) {
    if (n?.tagName === 'H2' || n?.tagName === 'H3') { section = n.textContent.trim(); break; }
    if (!n) break;
  }
  return { src: img.src, alt: img.alt, caption: cap, section };
}).filter(Boolean);
```

### Bucket assignment (keyword pass on caption + section)

```
section "Where to Stay" OR caption matches /hotel|lobby|room|suite|inn|riad|ryokan|villa/  → boutique-stay
section "Where to Eat"  OR caption matches /restaurant|chef|menu|dish|tasting|bar|café|coffee|market/  → foodie
caption matches /mountain|beach|coast|trail|fjord|garden|park|view|overlook|sunset|cliff|lake|river|island|harbor/  → natural-beauty
caption matches /street|neighborhood|architecture|design|shop|boutique|tile|façade|plaza|square|alley/  → city-aesthetic
caption matches /sunny|fog|alpine|snow|haze|breeze|dusk|dawn/  → climate-feel
```

Multi-bucket images get tagged with both buckets; the renderer uses whichever bucket is empty for that destination. **Hero masonry** pulls the highest-rank photos across all buckets.

### Place-name → image linkage (for the visual itinerary)

After scraping, build an index per destination:

```
place_name (lowercased, normalized)  →  [photo_id, ...]
```

Walk every photo's caption and check if any of the destination's named places (from the editorial source's "see/do/eat/stay" sections) appears as a substring. If yes, push the photo's id into the place's bucket. The composition step uses this index to attach photos to each itinerary slot.

### Hard rules (carry over from sibling skills)

- **Don't drill into per-destination booking sites for operational data** (hours, prices) — that's not what this skill does; the trip-level scope ends at "where" + "with what character," not "what time does the bakery open."
- **Strip CMS residue** from extracted text (HTML entities, markdown syntax) — copy `tools/_normalize-barcelona.mjs#unesc` pattern.
- **Never hallucinate a place's location** — if a source doesn't say it, leave it null and let geocoding speak.

---

## Step 4 — Normalize + upsert as candidates

Each entry becomes:

```json
{
  "slug": "lisbon-portugal",
  "name": "Lisbon",
  "country": "Portugal",
  "region": "coast",
  "lat": 38.71, "lng": -9.14,
  "status": "candidate",
  "scores": {},
  "operational": {
    "airport_codes": ["LIS"]
  },
  "sources": [
    { "type": "nyt36hours", "url": "...", "title": "36 Hours in Lisbon" },
    { "type": "cnt-hotlist-2026", "url": "...", "title": "..." }
  ]
}
```

Save the per-destination raw scrape (with images) as `dest-<slug>-raw.json` at the repo root. Pipe normalized destinations to:

```bash
node tools/upsert-trip-destinations.mjs <trip-id> < destinations-pass1.json
```

---

## Step 5 — Apply hard filters

Read `trip.hard_filters`. For each filter:

| Filter | How to apply |
|---|---|
| `exclude_recently_visited` | Read `preferences/travel.md` "Recently visited" section. **Honor the family-rich-revisit nuance**: cities with strong family/friend ties (per the City contacts table) should NOT be excluded, only soft-demoted (~0.3 composite penalty). Hard-exclude only the "pure-discovery" entries explicitly flagged as out (e.g., Seattle, London for summer 2026). When in doubt, keep as a candidate and let scoring decide. |
| family-visit cooldown (always-on rule, not a flag) | Per ghostwheel `travel.md`: parents 3-month cooldown, cousins/friends/siblings 6-month cooldown. If a destination has `operational.recently_visited.last_visited_iso`, the score script applies a soft demotion that ramps from −0.6 (saw them last week) to 0 (saw them just past cooldown). Tag destinations the family has actually visited recently with `operational.recently_visited = { last_visited_iso, who, cooldown_months }` during enrichment, OR by reading `done/<trip>.md` artifacts in ghostwheel. The renderer surfaces this as an italic "↩︎ Just visited" pill on the destination card so the family sees *why* it dropped in the ranking. |
| `no_oppressive_heat` | Soft pre-flag — needs climate enrichment from Step 6. After climate runs: reject destinations with `avg_high_F > 90` AND no coastal/water mitigation in `region`. **Do NOT auto-reject 84–90°F** — those are scored down via the climate rubric, not rejected. |
| `pit_accessible` | Per the 2026-04-27 ghostwheel revision, **1-stop is fine**. Use this filter only to reject 3+stop or remote-island destinations where door-to-door time exceeds 1/4 of trip duration. |

Always **mark, never delete** — rejection_reason on the row preserves the audit trail. The picker filters them out.

---

## Step 6 — Operational enrichment

```bash
# Airport codes need to be set on each destination first (manual or via skill judgment).
# Climate (Open-Meteo, free):
node tools/enrich-trip-climate.mjs <trip-id>

# PIT routing (curated nonstops list):
node tools/enrich-trip-flights.mjs <trip-id>

# Visa/passport: handled inline during composition for finalists only.
# Use WebSearch per finalist; the answer changes too often to maintain a static list.
```

After enrichment, re-apply the soft hard-filters from Step 5 (`no_oppressive_heat`, `pit_accessible`).

---

## Step 7 — Score the survivors

Each surviving destination is scored 0–5 on each bucket. Scores are **judgment calls grounded in evidence**, not algorithms — but the rubric below keeps them defensible.

| Bucket | Rubric |
|---|---|
| `climate_fit` | **5** = avg high 65–84°F (wide sweet spot per 2026-04-27 ghostwheel revision). **4** = 60–65 (chilly side) OR 84–88 with coastal/lake/altitude mitigation. **3** = 55–60 (cool, landscape-driven only) OR 84–88 without mitigation OR 88–92 with mitigation. **2** = <55°F or 88–92°F + no mitigation. **1–2** = oppressive heat (>92°F) with no mitigation; wildfire-flagged + hot. |
| `pit_accessibility` | **5** = nonstop, year-round. **4.5** = nonstop seasonal. **4** = 1-stop with sane layover, total transit ≤ 1/8 of trip duration (per ghostwheel "what matters is total time"). **3** = 1-stop, total transit ≤ 1/4 of trip duration. **2** = 2+-stop or remote routing. (Weight reduced from 1.5 → 1.0 in 2026-04-27 revision since 1-stop isn't a real penalty.) |
| `natural_beauty` | 5 = world-class landscape (fjords, alpine, dramatic coastline) named in 3+ sources. 4 = strong nature anchor. 3 = nice but not headline. 1–2 = mostly urban. |
| `city_aesthetic` | 5 = walkable + photogenic + design-forward (3+ sources call this out). 4 = strong aesthetic city. 3 = pleasant city. 1–2 = limited urban appeal. |
| `foodie_light` | 5 = strong sushi/seafood/tapas/Mediterranean/Japanese scene named in multiple sources, light cuisine fits. 3 = decent food scene. 1–2 = heavy/limited cuisine that fights the family's "no rich/cream/cheese" preference. |
| `boutique_stays` | 5 = ≥2 design-forward boutique hotels named in sources. 3 = at least one. 1–2 = mostly chain or ultra-luxury. |
| `instagrammy` | 5 = sources explicitly cite design/photo moments (a teen would post). 3 = some. 1–2 = few. |

Weights (for `composite_score = sum(w_i * s_i) / sum(w_i)`):

```
climate_fit:        2.0    // hard family preference (range 65–84 sweet spot)
pit_accessibility:  1.0    // softened 2026-04-27 — 1-stop fine; total time vs trip length matters
natural_beauty:     1.5    // Niki + Carissa
city_aesthetic:     1.2    // Ashi + family
foodie_light:       1.2    // family
boutique_stays:     1.0    // family
instagrammy:        0.8    // Ashi-weighted
```

Don't expose these weights as a knob — they encode the family's profile from ghostwheel. If preferences shift, update ghostwheel first, then these.

After scoring, set `composite_score` on each row, sort, mark top 6–10 `status='finalist'` with `ranking` (1 = top).

---

## Step 9 — Drill into finalists' source articles (the cross-source mention pass)

For each of the top 6–10 finalists, walk each of its `sources[]` entries that has a per-destination article URL. Open the article with Playwright MCP, scroll to load all content, and extract every named place.

### Per-source article scrape

```js
() => {
  // Walk every <h2>/<h3>/<h4> as a section header, then within each section,
  // collect every <strong>, <b>, <a href> and emphasized place name.
  // For NYT 36 Hours specifically, day blocks have h2/h3 like "Day 1" and
  // sub-sections "Where to Eat", "What to See and Do" — capture both.
  const sections = [];
  let currentDay = null, currentSection = null, currentSubsection = null;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let n;
  while ((n = walker.nextNode())) {
    const tag = n.tagName;
    const txt = (n.textContent || '').replace(/\s+/g,' ').trim();
    if (tag === 'H2') {
      if (/^Day \d/i.test(txt)) currentDay = txt;
      else currentSection = txt;
      continue;
    }
    if (tag === 'H3' || tag === 'H4') { currentSubsection = txt; continue; }
    // Collect bold/linked place names within paragraphs
    if ((tag === 'STRONG' || tag === 'B' || tag === 'A') && txt.length > 2 && txt.length < 80) {
      sections.push({
        place: txt,
        day: currentDay,
        section: currentSection,
        subsection: currentSubsection,
        snippet: n.parentElement?.textContent?.slice(0, 240).trim() || '',
        href: n.href || null,
      });
    }
  }
  return sections;
}
```

Save the result as `<destination-slug>-<source>-raw.json` at the repo root (e.g., `reykjavik-iceland-nyt36hours-raw.json`).

### Aggregate mentions across sources

For each destination, walk every `<destination>-<source>-raw.json`:

```js
const mentions = {};   // normalized place name → { count, sources, sections, snippets, category }
for (const file of articleFiles) {
  const sourceType = file.match(/-([^-]+)-raw\.json$/)[1];
  for (const m of readJson(file)) {
    const key = normalize(m.place);              // lowercased + accent-stripped
    const entry = (mentions[key] ||= { display: m.place, count: 0, sources: [], snippets: [], sections: [], category: null });
    entry.count++;
    if (!entry.sources.includes(sourceType)) entry.sources.push(sourceType);
    if (m.snippet) entry.snippets.push({ source: sourceType, text: m.snippet });
    if (m.section) entry.sections.push(m.section);
    entry.category = inferCategory(m.section, m.subsection, m.place);
  }
}
```

`inferCategory(section, subsection, place)` rule of thumb:
- section/subsection contains "Where to Eat"/"Restaurants"/"Lunch"/"Dinner" → `restaurant`
- section/subsection contains "Where to Stay"/"Hotels"/"Lodging" → `hotel`
- section/subsection contains "What to See"/"Things to Do"/"Day 1"/etc. → `sight`
- otherwise → `other`

### Reject criteria for mention candidates (avoid garbage)

- Place name length < 3 or > 60 characters → drop.
- Place name appears only once across all sources AND has no `href` → drop (probably scrape noise).
- Place name matches a city/country name already in our destination's `name` field — these are about the *destination itself*, not picks within it (e.g., "Reykjavík" mentioned within a Reykjavík article is noise).
- Generic words like "the river", "downtown", "the harbor" — drop via stopword list.
- Hand-curate a per-destination `SKIP` set for false positives discovered during composition.

### Save per-destination mentions JSON

`<destination-slug>-mentions.json`:

```json
{
  "destination": "Reykjavík + South Iceland",
  "sources_drilled": ["nyt36hours", "lpbit2026", "cntraveler", "tl50best", "afar"],
  "mentions": [
    { "display": "Hallgrímskirkja",   "count": 4, "sources": ["nyt36hours","cntraveler","tl50best","afar"], "category": "sight",      "snippets": [...] },
    { "display": "Dill",               "count": 3, "sources": ["nyt36hours","cntraveler","tl50best"],         "category": "restaurant", "snippets": [...] },
    { "display": "Reynisfjara",        "count": 3, "sources": ["nyt36hours","tl50best","afar"],                "category": "sight",      "snippets": [...] },
    { "display": "Sand Hotel",         "count": 2, "sources": ["nyt36hours","cntraveler"],                     "category": "hotel",      "snippets": [...] }
  ]
}
```

This file is the single ground truth for Step 10 composition.

---

## Step 10 — Compose finalist reports + visual itineraries (mention-driven)

For each of the top 6–10 destinations:

### `report_md` — the long-form case (driven by `<destination>-mentions.json`)

4–7 paragraphs in markdown. Sections (use these as `##` headers, in this order):

1. **The place** — character/setting in 2–4 sentences.
2. **What every source agrees on** — bullet list of the **top 5–8 mention-counted places**, sorted by count desc. Each bullet leads with the place name in bold, then a short rationale weaving in 1-2 source-snippet quotes. Format:
   ```markdown
   - **Hallgrímskirkja** (4 sources) — *"Reykjavík's basalt-column landmark; elevator to the top for the Lego-roof view"* (NYT 36 Hours, CNT, T+L, AFAR).
   - **Reynisfjara Black Sand Beach** (3 sources) — *"Basalt columns, rough Atlantic; rip-tide warning is real"* (NYT, T+L, AFAR).
   ```
   This is **not** training-knowledge curation — every place must come from `<destination>-mentions.json` with `count >= 2`, ranked by count.
3. **The natural side** — picks from `mentions` filtered to category=`sight` AND sections matching nature keywords. Highlight the highest-mention picks.
4. **The city side** — picks from `mentions` filtered to category=`sight` with city/neighborhood/shop section context.
5. **The food side** — top mention-counted picks where `category=restaurant`. List 4–6, with source mention count after each. Skip restaurants that violate the family's dietary constraints (cream-heavy, cheese-forward).
6. **Where to stay** — top mention-counted pick where `category=hotel`. Becomes `hotel_pick`. Rationale weaves snippets from the sources that named it.
7. **Risks / tradeoffs** — one paragraph on the realistic downsides for this family at this time.

**Hard rule:** every named place in sections 2–6 must be sourced from `<destination>-mentions.json`. If composition wants to add a place not in the mentions index, that's a sign the article scrape missed something — go back and re-scrape the source rather than fabricate.

**Do NOT narrate preference-fit** ("this fits Carissa's love of mountains") — it's implicit. Just describe what the place is.

### `itinerary` — visual sample itinerary (structured JSON)

```json
[
  {
    "day": 1,
    "slots": [
      {
        "key": "1-morning",
        "type": "morning",
        "label": "Morning — Nature / Beauty / Museum",
        "place_name": "Pena Park, Sintra",
        "text": "Open at 9:30; arrive early to beat the bus tours. Walk down through the Fern Garden to the Moorish castle, ~3 hours total.",
        "photo_ids": [12, 17]
      },
      { "key": "1-lunch",     "type": "lunch",     "label": "Lunch",                "place_name": "Tasca da Esquina",  "text": "Vincent Farges Mediterranean tasting; fish-forward and unfussy.", "photo_ids": [22] },
      { "key": "1-afternoon", "type": "afternoon", "label": "Afternoon — City / Walk / Shop", "place_name": "Príncipe Real",     "text": "Embaixada concept-store; LX Factory if you want grittier.",                "photo_ids": [9] },
      { "key": "1-dinner",    "type": "dinner",    "label": "Dinner",               "place_name": "Belcanto",          "text": "José Avillez tasting menu; book 6+ weeks ahead.",                                "photo_ids": [25] },
      { "key": "1-evening",   "type": "evening",   "label": "Evening — View / Bar", "place_name": "Park Bar",          "text": "Rooftop on the top of a parking garage; sunset over the river.",                 "photo_ids": [] }
    ]
  },
  // ... more days
]
```

**Slot types** — keep consistent across destinations: `morning`, `lunch`, `afternoon`, `dinner`, `evening`.

**Slot picking is mention-driven** — pull from `<destination>-mentions.json`:
- `morning` / `afternoon` slots → pick highest-mention `sight` not yet used
- `lunch` / `dinner` slots → pick highest-mention `restaurant` not yet used
- `evening` slot → pick highest-mention `sight` with bar/view/nightlife context, OR a `restaurant` if no nightlife pick

A slot place_name must exist in the mentions index. If the index has fewer picks than the itinerary needs, that's a real signal — either reduce itinerary days or re-scrape sources for more coverage. Never invent a place to fill a slot.

Build `itinerary` first (all slots), then write a copy of the photo manifest with `bucket: 'itinerary-slot'` + `itinerary_slot_key: '1-morning'` (etc.) so `mirror-trip-photos.mjs` uploads them to the slot-bucket.

### `hotel_pick`

```json
{
  "name": "Memmo Alfama",
  "summary": "42 rooms in a converted 17th-century palace in the old Moorish quarter. Plunge pool with city view. Walk to Lisbon Cathedral in 5 min.",
  "neighborhood": "Alfama",
  "approx_nightly_usd": 280,
  "source_url": "https://www.memmoalfama.com/",
  "mention_count": 3,
  "mention_sources": ["nyt36hours", "cntraveler", "afar"],
  "photo_ids": [44, 45, 46]
}
```

The hotel pick is **the highest mention-count entry** with `category=hotel` from `<destination>-mentions.json`. Including the count + sources in the JSON lets the renderer surface "named in 3 of 5 sources" alongside the pick. Photos for the hotel come from: (a) the sources that already mentioned it (with photo + caption) and (b) **as a v1 exception**, a quick scrape of the hotel's own gallery for lobby + room photos if sources are thin. Tag those with `bucket='boutique-stay'`, `source_name='<hotel>.com'`.

### Photo upload

After all photos are bucketed and tagged, upload them:

```bash
cat photo-manifest.json | node tools/mirror-trip-photos.mjs
```

The manifest shape is documented at the top of `mirror-trip-photos.mjs`. The tool downloads each source URL, dedupes by SHA-256, uploads to `trip-photos/<token>/<slug>/<bucket>-<hash>.<ext>`, and inserts the metadata row. After upload, IDs are assigned by Postgres — fetch them back and patch `itinerary[].slots[].photo_ids` and `hotel_pick.photo_ids` with the real IDs (a small post-upload step).

---

## Step 11 — Re-upsert finalists

Pipe the finalists with `report_md`, `itinerary`, `hotel_pick` filled in:

```bash
node tools/upsert-trip-destinations.mjs <trip-id> < finalists-composed.json
```

The upsert preserves enrichment fields (`scores`, `operational`) when input fields are null, so a Pass-2 input can include just composition fields without losing earlier work.

---

## Step 12 — Fetch Google Places photos for itinerary slots

After Step 11 has the new itinerary slot place_names, run:

```bash
node tools/enrich-trip-itinerary-photos.mjs <trip-id> --force
```

The `--force` flag deletes any prior slot photos and re-fetches via Google Places Text Search for the new place_names. Each photo gets the place's `googleMapsUri` stored as `source_url` so the hover state on the webapp links straight to the place's Google Maps page.

---

## Step 13 — Verify webapp render

Open `https://webapp-rust-phi.vercel.app/?t=<token>`. Verify:
- Hero masonry shows for each finalist
- Scorecard renders with bucket images inline
- Visual itinerary day blocks render with carousels for multi-image slots and styled text for image-less slots
- Hotel pick block has photos
- Report markdown is well-formatted
- Risks paragraph reads honestly

If any are broken, fix them before reporting.

---

## Step 14 — Report to user

```
Trip <trip-id> populated:
  Sources mined:        NYT 36 Hours archive, CNT Hot List 2026, AFAR seasonal, Lonely Planet Best in Travel, Reddit
  Candidates considered:   <N>
  Hard-filter rejects:     <N> (recently_visited: <N>, oppressive_heat: <N>, no_pit_routing: <N>)
  Finalists:               <N> ranked
  Top 3:                   <city1>, <city2>, <city3>
  Reports composed:        <N>/<N_finalists>
  Itineraries:             <N> with images / <N> total
  Hotel picks:             <N>/<N_finalists>
  Photos uploaded:         <N> across <N_buckets> buckets
  Share link:              https://webapp-rust-phi.vercel.app/?t=<token>
```

---

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Source badges say "5 verified sources" but the report's place picks read like generic training-knowledge | Skipped Step 9 — the per-finalist article drill-in. Badges become decorative without it. | Always run Step 9 for finalists; every place in the report must come from `<destination>-mentions.json` |
| Bucket image search returns generic stock-photo vibe | Targeted image search instead of caption-driven harvest from sources | Use the scrape captions; only fall back to targeted search for finalists with photo-thin sources |
| Report narrates "this fits Carissa's love of mountains" | Composition leaked preference-fit narration | Strip — fit is implicit in the selection |
| Visual itinerary all text-only | Place→image linkage didn't run / scrape didn't capture captions | Verify Step 3/9 output has `caption` and `place_mentions`; re-run normalizer |
| Itinerary slot has a place that isn't in mentions | Composition fabricated to fill the slot | Forbidden. Use only mentions. If the slot is empty, reduce itinerary days. |
| Climate enrichment fails for all dests | Lat/lng not set | Geocode destinations before climate enrichment (use a `tools/_geocode-destinations.mjs` helper or set lat/lng inline during normalize) |
| Hotel photos look stock | Hotel's own gallery is empty/thin; sources didn't include hotel photos | Pick a different hotel from the sources, or accept text-only hotel block |
| Recently-visited city snuck through | Slug mismatch between `preferences/travel.md` list and destination slug | Normalize both via `slugify()` before comparison |
| All scores cluster at 4.0–4.5 | Scoring isn't differentiating enough | Use the full 0–5 range; a 5 should be rare ("world-class" not "very good") |

---

## Related files

- **`ARCHITECTURE.md`** (next to this file) — system overview, three-layer pipeline, data model, invariants. Read first if you're new to the system.
- **`LESSONS.md`** (next to this file) — root-cause log indexed by topic (data acquisition, filtering, scoring, composition, photos, loyalty, family prefs, UX, operational data, architecture, process, open dragons). Read before starting — these are the dragons.
- `../discover-restaurants/SKILL.md` and `../discover-restaurants/LESSONS.md` — read first for shared scrape discipline.
- `../discover-activities/SKILL.md` — sibling for in-city activities.
- `tools/_load-travel-context.mjs` — ghostwheel reader (canonical preferences source).
- `tools/create-trip.mjs`, `tools/get-trip.mjs`, `tools/upsert-trip-destinations.mjs`, `tools/mirror-trip-photos.mjs` — the four trip CLI tools.
- `tools/enrich-trip-flights.mjs`, `tools/enrich-trip-climate.mjs` — operational enrichment.
- `tools/_pit-nonstops.json` — curated PIT nonstops list.
- `webapp/supabase/migrations/20260427000000_trips.sql` — schema source of truth.
- `webapp/index.html` — webapp; the `/?t=<token>` route renders trips.
