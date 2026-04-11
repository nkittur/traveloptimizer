---
name: discover-restaurants
description: Populate a group's restaurant list by scraping credible best-of lists for its city, normalizing them into the canonical schema, and writing to Supabase. Handles both fresh discovery (empty group) and refresh (diff against existing). Triggered when the user says "discover restaurants for group <id>", "populate <group>", or "refresh restaurants for <group>".
user-invocable: true
argument-hint: "<group-id>"
---

Populate a group's `group_restaurants` table by finding ≥3 credible best-of restaurant lists for the group's city, scraping them with Playwright MCP, normalizing into the canonical schema, and upserting.

## Inputs

- **group-id** (required, 8-char token): the group to populate. Look it up in the `groups` Supabase table to get city, country, criteria, target area.

## Preconditions

1. **Supabase is reachable.** URL + anon key live in `webapp/index.html`. The `tools/_db.mjs` helper reads them.
2. **Playwright MCP is available.** Every scrape MUST go through `mcp__playwright__browser_*` — never WebFetch on a JavaScript-driven site (Eater, Infatuation, Reddit, Yelp, Michelin all JS-render).
3. **Google APIs key** (`GOOGLE_MAPS_API_KEY` in `.env`) is only used by downstream enrichment scripts, not this skill.

## Step 1 — Load group context

```
node tools/get-group.mjs <group-id>
```

Prints the group row. Extract:
- `city_name`, `country` → used in every search query
- `criteria.freeText` → biases source selection + filtering
- `target_area` (may be null on first run — derived by this skill)

If the group doesn't exist, stop and tell the user the id is wrong.

## Step 2 — Pick sources

Aim for **≥3 high-credibility editorial lists + ≥1 crowd-wisdom source**. The right mix depends on the city:

**High-credibility editorial** — prefer these in roughly this order:
- **Eater** — `<city>.eater.com/maps/best-restaurants-*` and `-heatmap` (exists for most major US cities)
- **The Infatuation** — `www.theinfatuation.com/<city>/guides/...`
- **Michelin Guide** — `guide.michelin.com/en/.../<city>/restaurants` (best for cities with a Michelin presence — most European capitals, Tokyo, NYC, Chicago, SF)
- **Time Out** — `www.timeout.com/<city>/restaurants/best-restaurants-*`
- **Condé Nast Traveler** — `www.cntraveler.com/gallery/best-restaurants-*-<city>`
- **Local newspaper food critic** — LA Times, NYT, Guardian, El País, etc. — search `best restaurants <city> <year>` site:nytimes.com etc
- **50 Best** — `www.theworlds50best.com` for world-class cities

**Crowd wisdom** (≥1):
- **Reddit** — `r/<city>Food`, `r/<city>`, thread titles like "best restaurants", "can't miss", "underrated"
- **Local food subreddits** — r/FoodBarcelona, r/AskTO, r/AskNYC, etc.

**Reject**:
- SEO listicles (tripadvisor top 10, yelp top 10 — untrusted rankings)
- AI-generated content farms (generic-looking domains, no author byline, obvious LLM text)
- Outdated sources (>2 years old unless historically definitive)

**Adapt to criteria**: if `criteria.freeText` mentions vibes like "kid-friendly" / "fine dining" / "cheap eats" / "outdoor", add matching specialized sources (family travel blogs, Michelin-only, r/FoodCheap, etc.) and down-weight generic ones.

## Step 3 — Scrape with Playwright MCP

For each source:

1. `mcp__playwright__browser_navigate` to the URL
2. `mcp__playwright__browser_snapshot` to get structured content
3. Extract entries into the canonical shape (see Step 4)
4. If a site paginates or hides content behind interaction (click-to-expand, "show more"), use `mcp__playwright__browser_click` / `browser_evaluate` to get the full list

**Blocked sites**: Reddit often blocks headless browsers. If `browser_navigate` hits a block, try:
- Google search for the thread title and read the cached snippet
- Search for "<thread title> site:reddit.com" → click the Google result (Google's cache sometimes works)
- Skip Reddit for this group if all paths are blocked and note it in the discovery_run summary

**CRITICAL — feedback_verify_locations**: never claim a restaurant is at a specific location, neighborhood, or address unless a source explicitly confirms it. Past incident: a prior run hallucinated "Burgatory at Ross Park Mall" — Burgatory isn't there. If you're not sure, leave the field null and add a note. Never guess.

## Step 4 — Normalize to canonical schema

Every entry becomes this shape (matches existing SD data):

```json
{
  "id": "slug-of-name",
  "name": "Display Name",
  "neighborhood": "District / area name or null",
  "address": "Full street address or null",
  "price": "$$ | $$$ | $$$$ or null",
  "cuisine": "Short description, e.g. 'Catalan tapas' or 'New American'",
  "openFor": ["lunch", "dinner"] or null,
  "highlights": "1-3 sentence summary of why it's on the list. What's the dish? the vibe?",
  "insiderTip": "one-line tip from the source, or null",
  "website": "https://... or null",
  "inTargetArea": true,
  "notes": "any caveat worth preserving, or null",
  "sources": [
    { "type": "eater", "detail": "Eater 38 Best Restaurants in <city>", "rank": 7 },
    { "type": "infatuation", "detail": "The Infatuation 25 Best" }
  ]
}
```

Rules:
- **id**: lowercase, hyphenated, stripped of punctuation (same slug function as existing build.mjs). Must be unique within the group.
- **Dedupe across sources**: fuzzy-match by normalized name. When the same restaurant appears in multiple sources, merge into one entry and push all source refs into `sources`.
- **inTargetArea**: true for Phase-2 first pass (target area is derived post-geocode). After first run you can refine.
- **sources[].type**: one of `eater`, `eater_new`, `infatuation`, `michelin`, `timeout`, `cnt`, `50best`, `newspaper`, `reddit`, `local_blog`, `manual`.

Deliver the full array to stdin of the upsert helper.

## Step 5 — Create the discovery run + upsert rows

```bash
node tools/upsert-group-restaurants.mjs <group-id> < normalized.json
```

This script:
1. Inserts a new `discovery_runs` row and gets back `run_id`
2. For each incoming restaurant:
   - If not in `group_restaurants`: insert with `first_seen_run = run_id`, `last_seen_run = run_id`, `status = 'active'`
   - If already present: update `last_seen_run = run_id`, merge new source refs into the jsonb `data.sources`
3. For existing rows NOT in the incoming set: set `status = 'removed'` (keeps votes/comments for audit + "no longer recommended" display)
4. Finalizes the discovery_runs row with `places_added`, `places_removed`, `places_still_present`, `completed_at`, `summary`

Pipe the normalized JSON in via stdin or a temp file. The script prints the run id and counts.

## Step 6 — Enrichment pipeline (deterministic, non-LLM)

After upsert, run these three scripts in order. Each reads active rows from `group_restaurants` for the group, fills in one aspect, writes back. Each is idempotent.

```bash
node tools/enrich-group-geocode.mjs <group-id>   # Google Geocoding → lat, lng
node tools/enrich-group-details.mjs <group-id>   # Places API → rating, reviewCount, openingHours
node tools/enrich-group-photos.mjs <group-id>    # Places API → photos[]
```

After geocoding is done, compute the **target area hull** and update the group row:

```bash
node tools/compute-target-area.mjs <group-id>    # bounding hull from geocoded points
```

This sets `groups.target_area`, `groups.default_center`, `groups.default_zoom` from the actual data.

## Step 7 — Report to user

Print a short summary:

```
Discovery run <run-id> complete for group <group-id> (<city>):
  Sources scraped: <list>
  New: <n>, still present: <n>, removed: <n>
  Geocoded: <n>/<total>, with ratings: <n>/<total>, with photos: <n>/<total>
  Target area: <bbox>
  Share link: https://webapp-rust-phi.vercel.app/?g=<group-id>
```

## Refresh mode (re-runs)

If the group already has `group_restaurants` rows, this is a refresh. Same pipeline, but:
- Removed places stay in the table with `status='removed'` (votes/comments survive)
- The diff drives the "New since last visit" filter pill in the app (Phase 3)
- Tell the user which places are new and which were retired

## Failure modes and recovery

- **Site unreachable / blocked**: skip that source, note in `discovery_runs.summary.skipped_sources`. Don't fail the whole run unless <2 sources succeed.
- **Too few results (<10)**: widen criteria or add sources; don't commit a barren list.
- **Schema mismatch on normalization**: fix the entry, don't insert malformed jsonb. The upsert script validates required fields.
- **Supabase write failure**: retry once; if still fails, print the normalized JSON to a file under `trips/places/<city-slug>-backup-<timestamp>.json` so nothing is lost.

## Related

- `skills/refresh-restaurants/` — thin wrapper that just calls this skill in refresh mode (Phase 3)
- `tools/_db.mjs` — shared Supabase REST helper
- `webapp/supabase/migrations/20260411000000_groups.sql` — source of truth for the schema
