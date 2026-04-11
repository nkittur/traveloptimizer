---
name: discover-restaurants
description: Create and populate a city restaurant group. Scrapes credible best-of lists with Playwright MCP, normalizes into the canonical schema, and writes to Supabase. Handles creating a new group (if the user names a fresh city), fresh discovery against an empty group, and refresh (diff against existing). Triggered when the user says "discover restaurants for <city>", "populate <group>", or "refresh restaurants for <group>".
user-invocable: true
argument-hint: "<group-id> | <city name>"
---

Create or populate a group's `group_restaurants` table by finding ≥3 credible best-of restaurant lists for the group's city, scraping them with Playwright MCP, normalizing into the canonical schema, and upserting.

**Important**: groups are created exclusively here (via `tools/create-group.mjs`) or by the operator directly via the CLI. The webapp picker is read-only — it never creates groups. If the user wants a new city, this skill is where it starts.

## Inputs

- **Either**: an existing 8-char group token (e.g. `fgvy96yg`) — populate or refresh that group
- **Or**: a city name and optional criteria — create a new group first, then populate it. Ask the user any missing details (country, public vs private, their name, criteria focus) before creating the row.

## Preconditions

1. **Supabase is reachable.** URL + anon key live in `webapp/index.html`. The `tools/_db.mjs` helper reads them.
2. **Playwright MCP is available.** Every scrape MUST go through `mcp__playwright__browser_*` — never WebFetch on a JavaScript-driven site (Eater, Infatuation, Reddit, Yelp, Michelin all JS-render).
3. **Google APIs key** (`GOOGLE_MAPS_API_KEY` in `.env`) is only used by downstream enrichment scripts, not this skill.

## Step 1 — Load or create the group

**If the user gave a group id**, load it:

```
node tools/get-group.mjs <group-id>
```

Prints the group row. If the id doesn't resolve, stop and tell the user the token is wrong.

**If the user gave a city name (no id)**, you need to create the group first. Confirm the details interactively before creating — don't guess. Ask for any missing pieces:

- **name** — short display name for the picker, e.g. "Tokyo 2026 — Izakaya Hunt". If the user doesn't offer one, propose `"<City>"` as the default.
- **city** — canonical city name as it should appear in search queries (e.g. "Tokyo", not "東京"; "Mexico City", not "CDMX"). Required.
- **country** — improves geocoding fallbacks for international cities. Ask if not obvious.
- **public** — should this show up on the home-page Discover list so anyone can browse/vote/comment? Default to **private** unless the user says otherwise.
- **criteria** — free-text on vibe/price/focus. Biases source selection and filtering in Step 2. Empty is fine.
- **by** — the user's name, stamped as `created_by_name`.

Then create it:

```
node tools/create-group.mjs \
  --name "<display name>" \
  --city "<city>" \
  --country "<country>" \
  --criteria "<free text or omit>" \
  --by "<user name>" \
  [--public]
```

The command prints the new 8-char token to stdout. Capture it and use it as `<group-id>` for the rest of the pipeline.

From the loaded/created group row, extract:
- `city_name`, `country` → used in every search query
- `criteria.freeText` → biases source selection + filtering
- `target_area` (null on first run — derived by Step 6's enrichment pipeline)

## Step 2 — Pick sources

**Minimum sources for any run**: **≥3 high-credibility editorial lists + Reddit (mandatory)**. Reddit is not optional — a past run skipped it and the resulting list was missing hidden gems and local favorites that editorial critics don't cover. See Step 3 for the proven Reddit workflow.

**High-credibility editorial** — prefer these in roughly this order:
- **Eater** — `<city>.eater.com/maps/best-restaurants-*` and `-heatmap` (exists for most major US cities). For non-US cities, try `www.eater.com/maps/best-restaurants-<city>` (Barcelona, Paris, etc. have standalone Eater guides).
- **The Infatuation** — `www.theinfatuation.com/<city>/guides/...` (mostly US + London; often absent for continental European and Asian cities — check 404)
- **Michelin Guide** — `guide.michelin.com/us/en/<region>/<city>/restaurants/all-starred` for starred lists. The `data-dtm-distinction` attribute on each card gives the star count (`THREE_STARS`/`TWO_STARS`/`ONE_STAR`/`BIB_GOURMAND`). If the page shows results from a different region, it's geo-routing: search Google for `"guide.michelin.com" <city> all-starred` and use the regional URL Google surfaces. Best for cities with a Michelin presence — most European capitals, Tokyo, NYC, Chicago, SF.
- **Time Out** — `www.timeout.com/<city>/restaurants/best-restaurants-*` — best detailed entries (address, hours, price range) when available, but list length is often shorter than Eater or CNT.
- **Condé Nast Traveler** — `www.cntraveler.com/gallery/best-restaurants-in-<city>`. Uses lazy-loaded gallery: the full list is in `window.__PRELOADED_STATE__.transformed.gallery.items` — click-through won't work but the state blob does.
- **Local newspaper food critic** — LA Times, NYT, Guardian, El País, etc. — search `best restaurants <city> <year>` site:nytimes.com etc.
- **The World's 50 Best** — `www.theworlds50best.com/list/1-50` and `/list/51-100`. Filter the page body for entries containing the city name. Only produces 0–4 entries per city but gives strong "globally recognized" signal.

**Crowd wisdom — mandatory**:
- **Reddit** — `r/<City>` (proper-noun sub, e.g. `r/Barcelona`), plus food-specific subs if they exist (`r/FoodSanDiego`, `r/FoodNYC`, `r/AskTO`, `r/AskNYC`). For at least **2–3 distinct threads**, surface the top-upvoted recommendations and cross-reference with editorial. See Step 3 for the exact workflow.

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

### Reddit workflow (mandatory)

Reddit is the highest-signal crowd-wisdom source and you MUST hit it for every city. It surfaces hidden gems, local favorites, and authentic ethnic spots that editorial critics miss. On the Barcelona run, Reddit caught Xerta (a Michelin-starred restaurant the Michelin scrape itself had missed), Yakumanka (Gastón Acurio's Peruvian flagship), and El Pachuco (a beloved cheap Mexican spot) — none of which appeared on any editorial list.

Playwright MCP handles Reddit fine on `old.reddit.com`. Don't over-think it.

1. Find threads via Google search:
   ```
   https://www.google.com/search?q=site%3Areddit.com%2Fr%2F<City>+best+restaurants
   ```
   Extract result URLs matching `reddit.com/r/<City>/comments/`.
2. Pick 2–3 threads with strong titles — "Top favorite restaurants", "can't miss", "best for <price range>", "underrated", "where do locals eat". Skip meta threads and anything with <10 comments.
3. Navigate each via `old.reddit.com` (the old site renders comments server-side and is straightforward to extract from):
   ```
   https://old.reddit.com/r/<City>/comments/<thread-id>/
   ```
   Extract comments with scores via `browser_evaluate`:
   ```js
   document.querySelectorAll('div.comment').forEach(c => {
     const score = parseInt(c.querySelector('.tagline .score.unvoted')?.textContent.match(/-?\d+/)?.[0] || '0');
     const body = c.querySelector('.entry .md')?.textContent?.trim();
     if (body && body.length > 3) comments.push({ score, body });
   });
   ```
4. Save each thread to a raw JSON file (`reddit-thread-N.json`) so you can read it offline while composing picks.
5. Read the top-scored comments yourself and pick restaurants by judgment. **No regex — judgment**. Rules:
   - A restaurant named in a comment scored ≥5 with positive sentiment is a strong signal.
   - The same restaurant named across 2+ threads is stronger still.
   - Skip restaurants with mixed reception (one high-score rec AND a high-score "that place is terrible" reply).
   - Skip chains and hotel-restaurants unless context makes them notable.
6. In the per-city normalizer, split picks into:
   - **Matches for existing editorial entries** — add a `reddit` source with a `mentions` count (and a short `quote` if a comment had memorable framing)
   - **New finds** — add as fresh rows with a short `highlights` synthesized from the Reddit commentary. Enrichment fills the rest.
7. After merging, confirm Reddit contributed real signal — either cross-validation of editorial picks or new finds. If you only got overlaps, try more threads.

**CRITICAL — feedback_verify_locations**: never claim a restaurant is in a specific neighborhood unless the source explicitly says so. Past incident: a prior run hallucinated "Burgatory at Ross Park Mall" — Burgatory isn't there. If you're not sure, leave `neighborhood` null and let the enrichment pipeline's geocode result speak for itself. Never guess.

## Step 4 — Normalize to canonical schema

### Compose descriptions yourself. This is not an algorithm.

The `highlights` field on each restaurant is a Zagat-style distillation of everything you know about it. **Do not try to automate this.** Algorithmic approaches — pick-the-longest-source, primary-plus-secondary stitching, similarity-based sentence filtering, credentials-line prefixes — all produce robotic output that misses the point. The job is to read everything and write a sentence that captures what matters.

The process for **each** restaurant:

1. **Read all available sources**. For a given entry, gather every piece of text you have:
   - Full editorial prose from each scrape source (CNT's dek, Eater's review, Time Out's write-up, newspaper reviews, etc.)
   - Michelin star count if any
   - 50 Best rank and year if any
   - Reddit thread mentions and the actual upvoted comments that named it
   - **Google Places user reviews** (the top ~5, fetched by `enrich-group-details.mjs` and stored on `data.googleReviews`). Yes, these matter — real diners surface things critics don't, and a memorable phrase in a Google review can anchor a description.
2. **Identify what matters**. For a user reading this card on a mobile phone, what are the 3–5 things they most need to know?
   - What *kind* of place is it? (Cuisine, concept, setting.)
   - *Why* is it on the list? (Chef pedigree, credentials, signature technique.)
   - What should they *order*? (Specific signature dishes, ideally cross-referenced between sources.)
   - What's the *practical* info? (Hard to book, lunch-menu bargain, cash-only, no walk-ins.)
   - Any *crowd signal* worth surfacing? (r/Barcelona calls it the best under-€20 pick, a Google reviewer used a memorable phrase, etc.)
3. **Write 1–3 tight sentences** in Zagat's voice-neutral, omniscient-narrator register. Use quoted phrases from sources when they're evocative. Don't cite sources inline ("CNT says…" / "Eater adds…") — the source badges already show where the info came from.
4. **Skip hedges, filler, and algorithmic artifacts**. No "Three Michelin stars. A meal at X is…" sentence-fragment credential lines, no "r/City N mentions." codas, no per-source attribution labels. Weave credentials naturally into the prose ("Three Michelin stars and named #1 in the World's 50 Best 2024, this El Bulli-alum tasting menu is…").

#### Worked example — Disfrutar

**Raw inputs**:
- CNT dek (~900 words): "A meal at Disfrutar is like a performance: There's fire, ice, smoke, and lots of flavor and color. What started as an exciting new project by three ex-chefs from the late, great El Bulli has achieved the pinnacle of success in its own right—being awarded three Michelin stars and named the best restaurant in the world—officially, in the 2024 edition of The World's 50 Best Restaurants. … Top dishes include the crispy egg yolk with mushrooms and the chocolate peppers with oil and salt…"
- Michelin distinction: `THREE_STARS`
- 50 Best: 2024 #1
- Google reviews: "A masterclass in playful fine dining… Disfrutar absolutely delivers," "creativity, technique, and storytelling all collide," "founded by three chefs from the legendary El Bulli"
- Reddit: no mentions

**Composed output** (one paragraph, ~400 chars):
> *"Three El Bulli alumni — Mateu Casañas, Oriol Castro, Eduard Xatruch — serving the world's most playful tasting menu, 'like a performance: fire, ice, smoke, and lots of flavor and color.' Three Michelin stars and named #1 in The World's 50 Best Restaurants 2024. Don't miss the crispy egg yolk with mushroom gelatin, the chocolate peppers with oil and salt, or the Beluga-caviar 'panchino' bao. Book months ahead; trust the Classic menu on your first visit."*

Notice what this does and doesn't do:
- **Names the chefs** (pulled from Google review mention of "founded by three chefs from El Bulli" + my own knowledge of who they are)
- **Weaves credentials into the prose** — Michelin + 50 Best are part of the opening, not a separate prefix line
- **Quotes the memorable phrase** from CNT about fire/ice/smoke
- **Lists specific signatures** cross-referenced from multiple sources (including the "panchino" bao, which is in one of the source reviews)
- **Ends with a practical tip** (book far ahead, start with the Classic menu) — that's the "what does the user need to know to act on this"

### Storage shape — per-city descriptions file

Put the hand-crafted descriptions in a per-city JSON file like `trips/places/<city>-descriptions.json`, keyed by slug:

```json
{
  "disfrutar": "Three El Bulli alumni — Mateu Casañas, Oriol Castro, Eduard Xatruch — serving the world's most playful tasting menu…",
  "besta": "Catalonia-meets-Galicia tasting menus from chefs Carles Ramón and Manu Núñez — surf-and-turf pushed to another level…"
}
```

The normalizer's compose step becomes a pure lookup: `composeHighlights(entry) => handCrafted[entry.id] || fallback(entry)`. Every entry in the city should have a hand-crafted description; the fallback exists only as a safety net.

### Google reviews aren't a separate UI element

**Do not render `googleReviews` as a distinct block on the card.** The user explicitly said this is wrong: Google reviews are an input to your composition, not an output. If a user-review phrase is evocative enough to include, weave it into the single `highlights` paragraph. Otherwise, leave it in the data (still useful for future composition passes) but don't surface it separately.

Example output for Disfrutar (3 sources — CNT + Michelin + 50 Best):

> *"Three Michelin stars; World's 50 Best #1 (2024). A meal at Disfrutar is like a performance: There's fire, ice, smoke, and lots of flavor and color. What started as an exciting new project by three ex-chefs from the late, great El Bulli has achieved the pinnacle of success in its own right—being awarded three Michelin stars and named the best restaurant in the world—officially, in the 2024 edition of The World's 50 Best Restaurants. The tasting menus that are playful, unpredictable, often surprising us by telling our eyes one thing but sending our taste buds a completely different message."*

Example output for ABaC (Michelin-only, no editorial prose):

> *"Three Michelin stars."*

That's fine — single-credential entries get a short line. Don't pad them with fake content.

### Sentence-boundary truncation (never mid-sentence)

Past runs used a hard char slice (`.slice(0, 500)`) that cut mid-word ("…sending our taste buds a comp"). The fix is to split on `[^.!?]+[.!?]+` and keep adding whole sentences until adding the next one would overflow the budget. Reference implementation in `tools/_normalize-barcelona.mjs#sentenceTruncate`.

```js
function sentenceTruncate(s, maxChars = 700) {
  if (!s) return null;
  const sentences = s.match(/[^.!?]+[.!?]+/g) || [s];
  let out = '';
  for (const sent of sentences) {
    if (out.length > 0 && out.length + sent.length > maxChars) break;
    out += sent;
    if (out.length >= maxChars * 0.95) break;
  }
  return out.trim() || s.slice(0, maxChars).trimEnd() + '…';
}
```

### Canonical schema

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

**Enrichment-owned** (leave null, the pipeline writes them): `address`, `neighborhood`, `price`, `openFor`, `website`, plus `lat`, `lng`, `googleRating`, `googleReviewCount`, `googleReviews`, `openingHours`, `photos`, `photoUrl`.

**`googleReviews`** is the top ~5 user reviews fetched from Google Places API by `enrich-group-details.mjs` — shape `[{author, rating, text, time}, ...]`. The webapp renders them as pull-quote blocks on the card. This is a separate layer from the editorial `highlights`: editorial is curated critic prose, `googleReviews` is raw user voice. Both surface in the UI and serve different purposes.

Neighborhood is a gray area — if the source names it unambiguously ("Bar Canyí in Sant Antoni"), capture it. If not, leave null; the Places API lookup will often recover it from the formatted address or locality.

Rules:
- **id**: lowercase, hyphenated, NFD-normalized (accents stripped, not hyphenated). Use the `slugify` helper in `tools/_db.mjs` — it handles the NFD step correctly. Must be unique within the group.
- **Text cleanup**: strip HTML entities (`&nbsp;`, `&amp;`, `&apos;`), collapse markdown link syntax `[text](url)` → `text`, strip Kramdown link attributes `{: target="_blank"}`, normalize whitespace. Many editorial CMSs leak these.
- **Truncate `highlights`** to ~500 characters. Longer review text should end up in `notes` if it's worth keeping.
- **sources[].type**: one of `eater`, `eater_new`, `infatuation`, `michelin`, `timeout`, `cnt`, `50best`, `newspaper`, `reddit`, `local_blog`, `manual`.

### Cross-source merging — do this yourself, never use heuristics

When the same restaurant appears in multiple sources, you must merge the entries and union their `sources` arrays. **Do not rely on fuzzy substring/prefix matching to find duplicates.** A prior run used substring matching and falsely merged "El Rectangle" with "Angle" because `"rectangle".includes("angle")` is true. The damage from false positives (wrong restaurant shown, wrong source attribution) is much worse than a missed merge, so the bar for calling two entries "the same" is: **you personally verified it**.

The process for each city:

1. **Enumerate every unique raw name** you've scraped across all sources. Read them. Don't skim.
2. **Identify merge pairs through judgment**, looking for:
   - Identical names, modulo case/accents (those merge naturally via `slugify`, no action needed)
   - **Name drift**: "Lasarte" vs "Restaurante Lasarte", "Amar" vs "Amar Barcelona", "Martínez" vs "Terraza Martínez" — same restaurant, different display choices
   - **Truncations**: "COME Barcelona" vs "COME by Paco Méndez" — one source uses the short marketing name, another uses the full name
   - **Translations / local-language variants**: e.g. Chinese / Japanese / Arabic names that different sources romanize differently
   - **Punctuation or emphasis variants**: "Mont Bar", "Mont. Bar", "MONT BAR"
3. **For each merge pair, decide the canonical display name**. Pick the one that's clearest to a reader who's never been there — usually the shortest recognizable form. Michelin-official / chef-official names beat marketing truncations.
4. **Build a `CANONICAL_MERGES` table** in your per-city normalizer script. Format:
   ```js
   const CANONICAL_MERGES = {
     // <raw slug that slugify() would produce from the source's display name>
     'restaurante-lasarte': { slug: 'lasarte',             name: 'Lasarte' },
     'amar-barcelona':      { slug: 'amar',                name: 'Amar' },
     'come-barcelona':      { slug: 'come-by-paco-mendez', name: 'COME by Paco Méndez' },
     'martinez':            { slug: 'terraza-martinez',    name: 'Terraza Martínez' },
     // Self-mapping entries force the accented display name to win over a raw-ASCII variant:
     'terraza-martinez':    { slug: 'terraza-martinez',    name: 'Terraza Martínez' },
   };
   ```
5. **Run each raw entry's name through `slugify`** and check the merge table. Entries not in the table pass through with `{ slug: slugify(name), name }`. The normalizer then groups by final slug — natural same-slug entries merge for free, explicit merges happen via the table.

Look at `tools/_normalize-barcelona.mjs` for the working example. Every new city needs its own `_normalize-<city>.mjs` with its own hand-verified merge table. When uncertain whether two entries are the same, **skip the merge** (leave them as separate rows). Two rows that should be one is a small cosmetic issue; one row that should be two is wrong data.

Before committing, print the merge table's effect: list multi-source entries and eyeball them. Any row showing sources from wildly different cuisines or price ranges is probably a false merge — investigate before upserting.

Deliver the full normalized array to stdin of the upsert helper.

## Step 5 — Create the discovery run + upsert rows

```bash
node tools/upsert-group-restaurants.mjs <group-id> < normalized.json
```

This script:
1. Inserts a new `discovery_runs` row and gets back `run_id`
2. For each incoming restaurant:
   - If not in `group_restaurants`: insert with `first_seen_run = run_id`, `last_seen_run = run_id`, `status = 'active'`
   - If already present: **replace** the `data.sources` array with the incoming sources, preserve enrichment fields (`lat`, `lng`, `googleRating`, `googleReviewCount`, `openingHours`, `photos`, `photoUrl`, `price`) from the existing row, update `last_seen_run = run_id`
3. For existing rows NOT in the incoming set: set `status = 'removed'` (keeps votes/comments for audit + "no longer recommended" display)
4. Finalizes the discovery_runs row with `places_added`, `places_removed`, `places_still_present`, `completed_at`, `summary`

**Important — each run is a complete snapshot.** The upsert does not merge sources across runs. If your current normalizer omits a source that a previous run included, that source attribution goes away. This is on purpose: it prevents stale source strings (from earlier format drifts) accumulating forever. If you want a source preserved, keep it in the normalizer. Enrichment fields (geocoding, ratings, photos, hours, price) ARE preserved across runs — you don't re-do Google API calls for restaurants that are still on the list.

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
