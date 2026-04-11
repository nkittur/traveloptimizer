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

**What the scrape is for (and what it is NOT for):**
- ✅ The scrape's job is to capture **name + editorial prose + source attribution** for each restaurant on each list. That's it.
- ❌ **Do not hunt for addresses, phone numbers, opening hours, price level, lat/lng, rating, or photos** in the scraped HTML. Those are enrichment-layer concerns. Google Places is the authoritative source and the enrichment scripts (`enrich-group-details`, `enrich-group-geocode`, `enrich-group-photos`) fill them in deterministically in Step 6.
- ❌ **Do not drill into per-restaurant detail pages** on the source site to extract structured venue data. Google Places already has it and will be more up-to-date.

A successful scrape of a single list source yields entries with just: `name`, `highlights` (editorial reasoning), `insiderTip` (if the source calls it out), `notes` (anything source-specific worth preserving), and a `sources` entry. Neighborhood is optional — capture it if the source mentions it by name, skip it if not. **Leave address/price/hours/rating/photos as null.**

Why: the scrape exists to answer "which restaurants belong in this group and why", not "where is this restaurant and when is it open". Mixing the two layers makes the scrape fragile (sites restructure their markup, addresses go stale) and duplicates work the enrichment pipeline already does well.

For each source:

1. `mcp__playwright__browser_navigate` to the URL
2. `mcp__playwright__browser_snapshot` to get structured content
3. If a site paginates or hides content behind interaction (click-to-expand, "show more", next-slide buttons), use `mcp__playwright__browser_click` to walk through. This is the **preferred** way to get every entry on a list.
4. **Pagination fallback**: if click-through fails (SPA that doesn't update the URL, broken handlers, rate-limited clicks), use `browser_evaluate` to read `window.__PRELOADED_STATE__`, `window.__NEXT_DATA__`, or `window.__INITIAL_STATE__` and extract the list array from there. Treat this as a fallback, not a first resort — state blobs can miss fields the rendered DOM has.
5. Extract entries into the canonical shape (see Step 4)

**Blocked sites**: Reddit often blocks headless browsers. If `browser_navigate` hits a block, try:
- Google search for the thread title and read the cached snippet
- Search for "<thread title> site:reddit.com" → click the Google result (Google's cache sometimes works)
- Skip Reddit for this group if all paths are blocked and note it in the discovery_run summary

**CRITICAL — feedback_verify_locations**: never claim a restaurant is in a specific neighborhood unless the source explicitly says so. Past incident: a prior run hallucinated "Burgatory at Ross Park Mall" — Burgatory isn't there. If you're not sure, leave `neighborhood` null and let the enrichment pipeline's geocode result speak for itself. Never guess.

## Step 4 — Normalize to canonical schema

Every entry becomes this shape. **Leave operational fields null** — the enrichment pipeline fills them in from Google Places.

```json
{
  "id": "slug-of-name",
  "name": "Display Name",
  "neighborhood": null,
  "address": null,
  "price": null,
  "cuisine": "Short description if the source names a style, e.g. 'Catalan tapas' — else null",
  "openFor": null,
  "highlights": "1-3 sentence summary from the source: why it's on the list, what's the dish/vibe/story",
  "insiderTip": "one-line 'do this' tip if the source has one, else null",
  "website": null,
  "inTargetArea": true,
  "notes": "source-specific caveat worth preserving, else null",
  "sources": [
    { "type": "eater", "detail": "Eater 38 Best Restaurants in <city>", "rank": 7 },
    { "type": "infatuation", "detail": "The Infatuation 25 Best" }
  ]
}
```

**Scrape-owned** (you fill from the source): `id`, `name`, `highlights`, `insiderTip`, `cuisine` (only if source names it), `notes`, `sources`, `inTargetArea`.

**Enrichment-owned** (leave null, the pipeline writes them): `address`, `neighborhood`, `price`, `openFor`, `website`, plus `lat`, `lng`, `googleRating`, `googleReviewCount`, `openingHours`, `photos`, `photoUrl`.

Neighborhood is a gray area — if the source names it unambiguously ("Bar Canyí in Sant Antoni"), capture it. If not, leave null; the Places API lookup will often recover it from the formatted address or locality.

Rules:
- **id**: lowercase, hyphenated, stripped of punctuation (use the `slugify` helper in `tools/_db.mjs`). Must be unique within the group.
- **Dedupe across sources**: fuzzy-match by normalized name. When the same restaurant appears in multiple sources, merge into one entry and push all source refs into `sources`. The upsert helper does this automatically on re-runs — merging happens on source-field union.
- **Text cleanup**: strip HTML entities (`&nbsp;`, `&amp;`, `&apos;`), collapse markdown link syntax `[text](url)` → `text`, strip Kramdown link attributes `{: target="_blank"}`, normalize whitespace. Many editorial CMSs leak these.
- **Truncate `highlights`** to ~500 characters. Longer review text should end up in `notes` if it's worth keeping.
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
