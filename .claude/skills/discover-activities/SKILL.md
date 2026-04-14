---
name: discover-activities
description: Create and populate a city "things to do" group for the travel-optimizer webapp. Scrapes credible travel guides with Playwright MCP, enriches with Google Places, hand-composes travel-guide-style descriptions, and writes to Supabase. Sibling of discover-restaurants — same infrastructure (group_restaurants table, enrichment pipeline, webapp), different sources and schema voice.
---

Base directory for this skill: /Users/nkittur/Dropbox/scripts/traveloptimizer/.claude/skills/discover-activities

Create or populate a group's `group_restaurants` table (same table — the webapp is entity-agnostic) with curated things-to-do entries for a city. Pull from ≥2 editorial travel guides + ≥1 itinerary-format source + Reddit + Atlas Obscura, and write hand-crafted descriptions.

**Read `../discover-restaurants/SKILL.md` first** — this skill reuses 80% of the restaurants skill's architecture (two-pass pipeline, merge rules, Reddit workflow, enrichment, composition guidance, LESSONS). This file only documents the **differences** that matter for activities.

## Infrastructure (identical to discover-restaurants)

- **Same tables**: `groups` row via `tools/create-group.mjs`; entries go into `group_restaurants` with activity data in the `data` JSONB column. No new schema needed.
- **Same enrichment**: `tools/enrich-group-all.mjs <group-id>` — Google Places works for museums, parks, beaches, landmarks, trails, breweries. Will fail silently for truly abstract entries ("take a cooking class," "speakeasy scene") — leave those as-is; the webapp handles missing lat/lng gracefully.
- **Same webapp**: Reads `data.category` (same slot as restaurants' cuisine). Activity categories like `"Hiking / Scenic"`, `"Museum / Art"`, `"Historic Estate / Grounds"` render identically to cuisine labels.
- **Same Pass 1/Pass 2 flow**: scrape → upsert with minimal highlights → enrich → compose descriptions → re-upsert.

## What's different

### 1. Sources

**Editorial — pick ≥2:**

- **Time Out** — `www.timeout.com/<city>/things-to-do/best-things-to-do-*` or `www.timeout.com/usa/things-to-do/best-things-to-do-in-<city>`. Clean numbered lists, 20–25 entries, rich descriptions.
- **Condé Nast Traveler** — `www.cntraveler.com/gallery/best-things-to-do-in-<city>*`. Works the same as their restaurant galleries — `window.__PRELOADED_STATE__.transformed.gallery.items` gets you the full list in one shot.
- **Atlas Obscura** — `www.atlasobscura.com/things-to-do/<city>-<region>`. **Unique value for hidden gems** — the only editorial source that surfaces offbeat attractions like haunted bridges, topiary gardens, vintage carousels, oddities. Usually 8–15 surface-level entries; total count advertised (e.g., "47") requires clicking "See All" but the top entries are the ones worth keeping. Don't chase the full 47 — quality > completeness for Atlas.
- **Local city magazine / tourism site** — `<city>magazine.com/things-to-do/*`, `explore<city>.com`, etc. Often Q&A or narrative format that scrapes poorly — skip if the structure is prose. Try one and move on if it's not clean.
- **"36 Hours" / "3 Days" / "Weekend in X" itineraries** — see below, this is the single highest-value discovery we've made.

**Itinerary format (the cross-cutting source):**

Articles titled **"36 Hours in <city>"** (NYT series), **"3 Days in <city>"** (Town & Country, Travel+Leisure), **"Weekend in <city>"**, or similar are gold for two reasons:

1. **High editorial quality** — these are written by travel journalists with budgets. Every pick was researched.
2. **Dual-purpose** — a single scrape gets you **both** restaurants and activities. The T&C Asheville piece yielded 25 places (10 restaurants + 15 activities) in one pass.

Google search: `"36 hours in <city>"` or `"3 days in <city>"`. Skip low-credibility blogs (generic layouts, no author bio, AI-written prose) — **Town & Country** scraped cleanly for Asheville; **NYT** uses a paywalled interactive format (2021+) that's hard to scrape but older article-format 36 Hours pieces work well.

**Extraction pattern for itinerary articles:**

```js
// Each Day has sub-headings like "What to See and Do" (activities) and
// "Where to Eat" (restaurants). Walk paragraphs between h2s, extract
// bolded/linked place names.
for (const h2 of document.querySelectorAll('h2')) {
  const text = h2.textContent.trim();
  if (text.match(/^Day \d/)) currentDay = text;
  else if (text === 'What to See and Do') currentSection = 'activity';
  else if (text === 'Where to Eat') currentSection = 'restaurant';
  // walk siblings until next h2, pick up <strong>/<b>/<a> names
}
```

**Then split the output** — `entries.filter(e => e.type === 'activity')` goes into the activities normalizer, `entries.filter(e => e.type === 'restaurant')` into the restaurants one. Same scrape, two destinations.

**False positives to filter** (per-city skip list):
- **Nearby town names** captured as "place names" — Asheville's T&C mentioned "Black Mountain" and "Weaverville" (towns, not restaurants).
- **Event names** — "Biltmore Blooms," "Afterglow," "Masterworks" — these are programming, not venues.
- **Tour-category phrases** — "guided tours," generic "brewery tour" — not a specific place.
- **Truncations** — a sentence ending in "…at The Med," where the comma was picked up in the bold (`"The Med,"`).

Maintain a `SKIP` set and `REMAP` table per city (see `tools/_normalize-asheville-activities.mjs` for the reference).

**Crowd wisdom — Reddit mandatory**, same as restaurants. `r/<city>` threads on "things to do," "hidden gems," "bucket list," "must-do's" are the richest source for locals-only picks (stargazing spots, secret gardens, free concerts, quirky museums).

**Curated canonical layer** (optional but recommended):

For any city with obvious must-do icons that editorial might under-cover (e.g., the Blue Ridge Parkway, Biltmore Estate, Grand Canyon, Golden Gate Bridge), add a `CURATED` array in the normalizer. These get their own source badge (`type: 'curated'`) and hand-crafted highlights up front — they're the backbone of the list. See `tools/_normalize-asheville-activities.mjs` — 17 curated canonicals ground the list before editorial/Reddit layer on top.

### 2. Schema

Same as restaurants, but use these fields differently:

```json
{
  "category": "Hiking / Nature | Museum / Art | Historic Estate | Scenic Drive | Brewery | ...",
  "price": null | "$" | "$$" | "$$$" | "$$$$",  // Free parks/trails → leave null; tours/admission → use $ range
  "openFor": null,  // Leave null; Google Places fills hours
  "category": "<activity category>"
}
```

**Category taxonomy suggestions** (keep consistent across cities):

- `Hiking / Nature`, `Hiking / Scenic`, `Hiking / Waterfalls`
- `Beach / Scenic`, `Scenic / Overlook`, `Scenic Drive`
- `Museum / Art`, `Museum / History`, `Museum / Culture`, `Museum / Games`
- `Historic Estate`, `Historic Site`, `Historic Hotel`
- `Park / Culture`, `Garden / Nature`, `Garden / Peaceful`
- `Zoo / Wildlife`, `Wildlife / Ocean`
- `Amusement Park`, `Entertainment`, `Sports`, `Music / Entertainment`
- `Neighborhood / Art`, `Neighborhood / Shopping`, `Neighborhood / Food`
- `Outdoor Adventure`, `Outdoor / River`, `Outdoor / Cycling`
- `Brewery`, `Craft Beer`, `Nightlife / Dining`
- `Hidden Gem`, `Oddity`, `Tour / Entertainment`
- `Stargazing`, `Market / Community`

### 3. Composition voice

**Restaurants** use Zagat's "voice-neutral omniscient narrator" register with dish names and service advice. **Activities** use a travel-guide register — what the thing IS, why it's worth your time, and one actionable practical tip:

- What it is (cultural/natural/historic context).
- Why it's worth your time (what makes it distinctive — "largest," "oldest," "only," "the crown jewel of").
- Practical angle (best time to go, how long it takes, entry cost, r/Reddit pro tip, free-admission day).

Example for Balboa Park:

> A 1,200-acre cultural oasis in the heart of the city — 17 museums (free rotating Tuesdays for SD residents), the Spanish Colonial Revival architecture of the 1915 Expo, the Botanical Building, International Cottages, and hidden cactus gardens. You could spend days here and still find something new. Start at the California Tower for the view.

Notes: names specific sub-attractions, includes a pro tip (Tuesday free days — from Reddit), closes with an actionable opening move.

### 4. Google Places coverage

Most activities geocode cleanly — museums, parks, specific trails, named viewpoints. Some won't:

- **Abstract "scenes"** like "San Diego Speakeasy Scene," "Craft Beer Scene" — these will default to city center. OK to leave as-is; the webapp renders them without a pin.
- **Unnamed events** ("Drum Circle at Pritchard Park") — geocode to the park, works fine.
- **Multi-location trails** — pick the main trailhead / visitor center.
- **Seasonal attractions** (Flower Fields in spring, Grunion Runs in summer) — geocode fine, mention seasonality in highlights.

`target-area` computation may flag remote day-trip entries as outliers (e.g., Anza-Borrego is 2 hours from San Diego). That's fine — the bbox drops them rather than stretching to include a desert 100 miles away.

## Pipeline (identical to restaurants)

```bash
# Step 1: Create group (or reuse existing)
node tools/create-group.mjs --name "<City> — Things to Do" --city "<City>" \
  --country "<Country>" --criteria "<focus>" --by "<user>" [--public]
# → prints 8-char group id

# Step 2: Scrape sources (Playwright MCP), save <source>-<city>-raw.json files
# Step 3: Write tools/_normalize-<city>-activities.mjs (see Asheville reference)
# Step 4: Pass 1 upsert
node tools/_normalize-<city>-activities.mjs
node tools/upsert-group-restaurants.mjs <group-id> < trips/places/<city>-activities-full.json

# Step 5: Enrich
node tools/enrich-group-all.mjs <group-id>

# Step 6: Compose descriptions → trips/places/<city>-activities-descriptions.json
# Step 7: Pass 2 re-upsert
node tools/_normalize-<city>-activities.mjs
node tools/upsert-group-restaurants.mjs <group-id> < trips/places/<city>-activities-full.json
```

## Reference files

- `tools/_normalize-sandiego-activities.mjs` — first activities normalizer, has the SDMag filter/remap pattern
- `tools/_normalize-asheville-activities.mjs` — simpler setup + curated canonical + T&C itinerary integration
- `trips/places/sandiego-activities-descriptions.json` — full hand-crafted set
- `trips/places/asheville-activities-descriptions.json` — reference for smaller city with curated canonicals

## Failure modes specific to activities

| Symptom | Cause | Fix |
|---|---|---|
| Lots of dropped entries after normalizer | Reddit-only entry with no matched thread, or Atlas entry with no description | Accept some drop — quality > quantity. For Atlas entries with no text, add a short highlight in a `CURATED` entry or drop. |
| T&C picked up town names as restaurants | Bolded "Black Mountain" inside a context paragraph | Per-city `TNC_SKIP` set |
| "Things to Do" generic SDMag-style headings ("Go on a Hike") | Lifestyle magazine format using activity-type headings | Per-entry REMAP to real places (Torrey Pines → "Go on a Hike") |
| Google Places returns null for "Scene" entries | Abstract concepts have no venue | Leave null; flag in report |
