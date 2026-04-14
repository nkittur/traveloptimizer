---
name: discover-restaurants
description: Create and populate a city restaurant group for the travel-optimizer webapp. Scrapes credible best-of lists with Playwright MCP, enriches with Google Places, hand-composes Zagat-style descriptions, and writes to Supabase. Handles creating a new group from a city name, fresh discovery against an empty group, and refreshing existing groups. Triggered when the user says "discover restaurants for <city>", "populate <group>", "refresh restaurants for <group>", or similar.
user-invocable: true
argument-hint: "<group-id> | <city name>"
---

Create or populate a group's `group_restaurants` table with a Zagat-quality list of restaurants for the group's city, pulling from ≥3 editorial sources + Reddit + Google Places, and writing hand-crafted descriptions.

**Required reading before executing:** `LESSONS.md` (next to this file) — a running log of every root cause fixed in prior runs. Skim it first so you don't repeat mistakes the last run already corrected.

**Groups are created only here** (via `tools/create-group.mjs`, which this skill wraps when given a city name). The webapp picker is read-only.

---

## Inputs

- **Either**: an existing 8-char group token (e.g. `fgvy96yg`) — populate or refresh that group.
- **Or**: a city name and optional criteria — create the group first, then populate it. Ask the user for any missing details (country, public vs private, their name, criteria focus) before creating the row.

## Preconditions

1. **Supabase reachable.** URL + anon key live in `webapp/index.html`; `tools/_db.mjs` reads them.
2. **Playwright MCP available.** Every scrape goes through `mcp__playwright__browser_*`. Never WebFetch on a JavaScript-driven site (Eater, Infatuation, Reddit, Yelp, Michelin, CNT — all JS-render).
3. **`GOOGLE_MAPS_API_KEY`** in `.env` — the enrichment scripts use it for geocoding, Places details, photos, and user reviews.

---

## Pipeline order — two passes, not one

This is the **most important structural rule** and the one prior runs got wrong. The full workflow is not single-pass:

```
 Pass 1 (populate + enrich):
   Step 1  Load or create the group
   Step 2  Pick sources
   Step 3  Scrape each source → save raw dumps
   Step 4a Normalize + cross-source merge (leave `highlights` empty or minimal)
   Step 5  Upsert to group_restaurants
   Step 6  Enrichment pipeline (geocode → details → photos → target-area)
           ↳ `enrich-group-details.mjs` populates `data.googleReviews` from Places API

 Pass 2 (compose + re-upsert):
   Step 4b Dump raw inputs per restaurant (editorial + Google reviews from DB)
   Step 4c Hand-craft Zagat-style descriptions into `trips/places/<city>-descriptions.json`
   Step 4d Re-normalize (loads descriptions file into `highlights`) + re-upsert
```

**Why two passes?** Google reviews are the highest-density user-voice source (they exist for *every* restaurant, unlike editorial), and they're only available after enrichment has run at least once. The composition step needs them — so composition happens *after* enrichment, not before. This was lesson L15 in `LESSONS.md`.

Every restaurant is multi-source because of Google reviews. Don't treat single-editorial-source entries as "thin data" — they still have 5 real diner reviews to compose from (L13).

---

## Step 1 — Load or create the group

**If the user gave a group id**, load it:

```
node tools/get-group.mjs <group-id>
```

If the id doesn't resolve, stop and tell the user.

**If the user gave a city name**, create the group first. Don't guess — ask interactively for:

- **name** — display name for the picker (e.g. "Tokyo 2026 — Izakaya Hunt"). Propose `"<City>"` as default.
- **city** — canonical city name in search queries (e.g. "Tokyo" not "東京", "Mexico City" not "CDMX"). Required.
- **country** — improves geocoding fallbacks. Ask if not obvious.
- **public** — shows on home-page Discover if true. Default **private** unless the user says otherwise.
- **criteria** — free-text on vibe/price/focus. Biases source selection in Step 2. Empty is fine.
- **by** — the user's name, stamped as `created_by_name`.

Then:

```
node tools/create-group.mjs \
  --name "<display name>" --city "<city>" --country "<country>" \
  --criteria "<free text>" --by "<user name>" [--public]
```

Captures the new 8-char token from stdout. Use it as `<group-id>` for everything downstream.

From the group row, extract `city_name`, `country`, `criteria.freeText`. `target_area` will be null until Step 6.

---

## Step 2 — Pick sources

**Floor: ≥3 high-credibility editorial lists + Reddit (mandatory) + Google reviews (automatic via enrichment).**

Every restaurant will end up with Google Places user reviews, so treat Google as a universal extra source that's free on every entry. Your scrape job is the editorial + crowd layer.

### Editorial — pick ≥3 from this list

- **Eater** — `<city>.eater.com/maps/best-restaurants-*` (major US cities have dedicated sites) or `www.eater.com/maps/best-restaurants-<city>-spain` (international). Usually the longest list (30+ entries) and has the richest per-entry prose.
- **The Infatuation** — `www.theinfatuation.com/<city>/guides/...` — mostly US + London, often 404 for continental European / Asian cities, check first.
- **Michelin Guide** — `guide.michelin.com/us/en/<region>/<city>/restaurants/all-starred`. The `data-dtm-distinction` attribute on each card gives the star count (`THREE_STARS`/`TWO_STARS`/`ONE_STAR`/`BIB_GOURMAND`). **Beware geo-routing** (L4): if the page shows restaurants from a different region, Google-search `"guide.michelin.com" <city> all-starred` and use the regional URL Google surfaces.
- **Time Out** — `www.timeout.com/<city>/restaurants/best-restaurants-*`. Detailed entries with address/hours/price-range but usually only 10-15 entries.
- **Condé Nast Traveler** — `www.cntraveler.com/gallery/best-restaurants-in-<city>`. Uses lazy-loaded galleries; the full list is in `window.__PRELOADED_STATE__.transformed.gallery.items`.
- **Local newspaper food critic** — NYT, LA Times, Guardian, El País, Le Monde, Asahi Shimbun, etc. Google-search `best restaurants <city> <year> site:nytimes.com` and similar.
- **The World's 50 Best** — `www.theworlds50best.com/list/1-50` and `/list/51-100`. Usually 0-4 entries per city but carries the strongest global prestige signal.
- **"36 Hours in X" / "3 Days in Y" itineraries** — search `"36 hours in <city>"` or `"3 days in <city>"` to find high-quality curated trip reports. Best sources: **NYT 36 Hours** (gold standard — but the 2021+ interactive format is paywalled and hard to scrape; older article-format entries work), **Town & Country** (excellent structured `Day 1/Day 2/Day 3` with `Where to Eat` subsections that parse cleanly — T&C scraped 25 places in one pass for Asheville), **WSJ**, **Travel+Leisure**. These are invaluable for **smaller cities** where Eater/Infatuation coverage is thin. They hit **both restaurants AND activities** in the same scrape — run the extractor once, split results by section headers (`Where to Eat` → restaurants group; `What to See and Do` → activities group, fed to the `discover-activities` skill). See `tools/_normalize-asheville.mjs` for the reference extractor and filter pattern. Watch for false positives: section headers can capture event names ("Biltmore Blooms," "Afterglow"), nearby town names ("Black Mountain," "Weaverville"), and tour-category phrases ("guided tours") — filter with a per-city skip list. Reject: generic blog-style itineraries with no author bio, AI content farms, boilerplate "top 10" SEO pages with no editorial voice.

### Crowd wisdom — Reddit is non-negotiable

**Skipping Reddit is the biggest single mistake** of the Barcelona run (L1). It caught Xerta (a Michelin-starred spot the Michelin scrape missed), Yakumanka (Gastón Acurio's Peruvian), El Pachuco, Bar H, Dos Pebrots — none of them on any editorial list. `r/<City>` and city-food subs (`r/FoodSanDiego`, `r/FoodNYC`, `r/AskTO`) are where hidden gems live.

### Rejection criteria

- **SEO listicles** (TripAdvisor top 10, Yelp top 10) — untrusted rankings.
- **AI-generated content farms** — generic domains, no author, boilerplate LLM prose.
- **Stale sources** — more than ~2 years old unless historically definitive (e.g. a classic guidebook).

### Adapt to criteria

If `criteria.freeText` names a vibe — "kid-friendly," "fine dining," "cheap eats," "outdoor" — bias toward matching specialized sources and down-weight generic ones.

---

## Step 3 — Scrape with Playwright MCP

### What the scrape is for (and what it is NOT for)

- ✅ Capture **name + editorial prose + source attribution** for each restaurant on each list.
- ❌ **Do not hunt for addresses, phone numbers, opening hours, price, lat/lng, rating, or photos** in the scraped HTML. Those are enrichment-owned (L5). Google Places API is the authoritative source and `enrich-group-details.mjs` fills them in deterministically in Step 6.
- ❌ **Do not drill into per-restaurant detail pages** on source sites to extract structured venue data.

The scrape answers "which restaurants belong in this group and why," not "where is this restaurant and when is it open." Mixing the two layers makes scrapes fragile and duplicates work the enrichment pipeline already does well.

### General scraping recipe

For each source:

1. `mcp__playwright__browser_navigate` to the URL.
2. `mcp__playwright__browser_snapshot` to get structured content.
3. If the page paginates or lazy-loads (click-to-expand, "show more," next-slide buttons), use `mcp__playwright__browser_click` to walk through every entry. **This is the preferred pagination method.**
4. **Fallback only** if click-through fails (SPA that doesn't update the URL, broken handlers): use `browser_evaluate` to read `window.__PRELOADED_STATE__`, `window.__NEXT_DATA__`, or `window.__INITIAL_STATE__`. State blobs sometimes miss fields the rendered DOM has (L2), so treat this as a fallback not a first resort.
5. Extract entries into the canonical shape (Step 4).
6. **Save the raw scrape to a file** at the repo root: `<source>-<city>-raw.json` (e.g., `cnt-barcelona-raw.json`, `eater-barcelona-raw.json`, `michelin-barcelona-raw.json`). The composition pass in Pass 2 reads these files.

### Verify scrape completeness (L3)

After every source, **count your entries** and compare to the source's advertised count. The source itself usually tells you: "The 38 Best Restaurants in Barcelona" → you should have 38. "34 Best" → you should have 34. Michelin's all-starred list for a major European capital is typically 25-50+ entries; if you got fewer, something's wrong.

If counts don't match:

- **Check for pagination you missed.** Click through once more, watch for a "Next" button or lazy-loaded content below the fold.
- **Check for geo-routing** (Michelin specifically). If the page shows restaurants from a different region, you're on a cached/default URL — switch regions.
- **Check for broken selectors.** Your DOM extraction may have dropped rows that didn't match the expected structure.
- **Check for a Wikipedia cross-reference.** If Wikipedia's "List of Michelin-starred restaurants in <city>" has more entries than you scraped, you missed some.

Don't move on from a source with a mismatched count without understanding why. A silent undercount means missing restaurants (see Xerta in L3).

### Reddit workflow (mandatory)

`old.reddit.com` works with Playwright MCP. Don't over-think it.

1. **Find threads** via Google search:
   ```
   https://www.google.com/search?q=site%3Areddit.com%2Fr%2F<City>+best+restaurants
   ```
   Extract URLs matching `reddit.com/r/<City>/comments/`.
2. **Pick 2–3 threads** with strong titles — "Top favorite restaurants," "can't miss," "best for <price range>," "underrated," "where do locals eat." Skip meta threads (anti-tourism rants, etc.) and anything with <10 comments.
3. **Navigate via `old.reddit.com`** (not `www.reddit.com`):
   ```
   https://old.reddit.com/r/<City>/comments/<thread-id>/
   ```
4. **Extract comments with scores** via `browser_evaluate`:
   ```js
   document.querySelectorAll('div.comment').forEach(c => {
     const score = parseInt(c.querySelector('.tagline .score.unvoted')?.textContent.match(/-?\d+/)?.[0] || '0');
     const body = c.querySelector('.entry .md')?.textContent?.trim();
     if (body && body.length > 3) comments.push({ score, body });
   });
   ```
5. **Save each thread** to `reddit-thread-<N>.json` at the repo root. You'll re-read them during the composition pass.
6. **Read top-scored comments yourself** and pick restaurants by judgment. No regex. Rules:
   - A restaurant in a comment scored ≥5 with positive sentiment = strong signal.
   - Named across ≥2 threads = stronger still.
   - Mixed reception (one high-score rec AND a high-score "terrible" reply) → skip.
   - Chains and hotel restaurants → skip unless context makes them notable.
7. **Split Reddit picks into two groups** for the normalizer:
   - **Matches for existing editorial entries** — add a `reddit` source (see attribution rules below).
   - **New finds** — add as fresh rows; they'll get descriptions composed in Pass 2.
8. **Per-restaurant thread attribution is mandatory** (L18). For each restaurant that gets a Reddit source, the normalizer must scan the saved thread files and attach ONLY the threads that actually mention it:
   ```js
   // For each candidate restaurant, scan every saved thread file's comments +
   // post body (lowercased, concatenated) for a literal substring match on
   // the restaurant name. Hand-curate aliases for short forms ("George's" for
   // "George's At The Cove", "Nine-Ten" for "Nine-Ten Restaurant and Bar").
   const matched = threads.filter(t => candidates(name).some(c => t.blob.includes(c)));
   if (matched.length > 0) {
     entry.sources.push({
       type: 'reddit',
       threads: matched.map(t => ({ title: t.title, url: t.url })),
       mentions: matched.length,                   // ALWAYS = threads.length
       detail: `r/${sub} — ${matched.length} thread${matched.length === 1 ? '' : 's'}`,
     });
   }
   // If no thread mentions the restaurant → don't attach a reddit source at all.
   ```
   **Invariant:** `sources[].mentions === sources[].threads.length`. The badge shows mentions, the detail view shows threads — if they diverge, the UI contradicts itself (the exact SD bug in L18).
   **Never attach a "universal threads list"** to every restaurant. The threads list is per-restaurant ground truth, not "threads we scraped."
   **If no thread matches**, drop the reddit source entirely. An unverifiable "N Reddit recs" badge is worse than no badge.
9. **Confirm Reddit added signal.** After merging, at least some Reddit entries should either cross-validate editorial picks or surface new places. If Reddit only produces overlaps AND no new finds, pick more threads.

### Text cleanup — CMS residue strippers (L14)

Editorial CMSs leak residue into their content. Your scrape's extracted text needs to strip, at minimum:

- HTML entities: `&nbsp;` → space, plus `&amp;`, `&apos;`, `&quot;`, `&#39;`, `&rsquo;`, `&lsquo;`, `&rdquo;`, `&ldquo;`, `&mdash;`, `&ndash;`
- Markdown-style inline links: `[text](https://...)` → `text`
- Kramdown link attributes: `{: target="_blank"}` → (strip)
- Markdown emphasis: `**text**` → `text`
- Collapsed whitespace

Reference implementation in `tools/_normalize-barcelona.mjs#unesc`. Every per-city normalizer should copy this.

### Never hallucinate locations

A prior SD run hallucinated "Burgatory at Ross Park Mall" — Burgatory isn't there. If a source doesn't explicitly state a neighborhood or address, leave `neighborhood` null and let the geocoding pipeline's result speak for itself. Never guess.

---

## Step 4 — Normalize + compose

This step is split across the two passes. Pass 1 (before enrichment) produces rows with merged sources but no real descriptions yet. Pass 2 (after enrichment) reads enriched data, hand-crafts descriptions, and re-upserts.

### 4a · Canonical schema

Every entry becomes this shape. **Leave operational fields null** — the enrichment pipeline fills them in.

```json
{
  "id": "slug-of-name",
  "name": "Display Name",
  "neighborhood": null,
  "address": null,
  "price": null,
  "cuisine": "Short style if the source names one, e.g. 'Catalan tapas' — else null",
  "openFor": null,
  "highlights": null,                    // composed in Pass 2
  "insiderTip": "one-line 'do this' tip from the source, else null",
  "website": null,
  "inTargetArea": true,
  "notes": "source-specific caveat worth preserving, else null",
  "sources": [
    { "type": "eater", "detail": "Eater 38 Best Restaurants in <city>", "rank": 7 },
    { "type": "cnt",   "detail": "Condé Nast Traveler 34 Best…",        "rank": 3 }
  ],
  "_rawDescs": { "eater": "...", "cnt": "..." }  // scratch — deleted before writeout
}
```

**Scrape-owned** fields (filled by the per-city normalizer): `id`, `name`, `cuisine`, `insiderTip`, `notes`, `sources`, `inTargetArea`, `_rawDescs`.

**Enrichment-owned** fields (left null until Step 6): `address`, `neighborhood` (unless a source is explicit), `price`, `openFor`, `website`, `lat`, `lng`, `googleRating`, `googleReviewCount`, `googleReviews`, `openingHours`, `photos`, `photoUrl`.

**Composed in Pass 2**: `highlights`.

### 4b · Cross-source merging — do this yourself, never use heuristics

When the same restaurant appears in multiple sources, merge the entries and union their `sources` arrays. **Do not rely on fuzzy substring/prefix matching to find duplicates.** A prior run used substring matching and falsely merged "El Rectangle" with "Angle" because `"rectangle".includes("angle")` is true (L6). Angle's Michelin credentials ended up on El Rectangle's card.

The damage from a false positive (wrong restaurant, wrong credentials) is much worse than a missed merge, so the bar is: **you personally verified it**.

Process:

1. **Enumerate every unique raw name** you've scraped across all sources. Read them. Don't skim.
2. **Identify merge pairs through judgment**:
   - Identical modulo case/accents — these merge naturally via `slugify`, no action needed.
   - **Name drift**: "Lasarte" vs "Restaurante Lasarte"; "Amar" vs "Amar Barcelona"; "Martínez" vs "Terraza Martínez."
   - **Truncations**: "COME Barcelona" vs "COME by Paco Méndez" — marketing short name vs chef-official name.
   - **Translations / romanization variants**: same restaurant with different Chinese / Japanese / Arabic / Cyrillic renderings.
   - **Punctuation variants**: "Mont Bar" / "Mont. Bar" / "MONT BAR".
3. **Pick the canonical display name.** The shortest recognizable form is usually best. Chef-official names beat marketing truncations.
4. **Build a `CANONICAL_MERGES` table** in your per-city normalizer:
   ```js
   const CANONICAL_MERGES = {
     // <raw slug that slugify() produces from a source's display name>
     'restaurante-lasarte': { slug: 'lasarte',              name: 'Lasarte' },
     'amar-barcelona':      { slug: 'amar',                 name: 'Amar' },
     'come-barcelona':      { slug: 'come-by-paco-mendez',  name: 'COME by Paco Méndez' },
     'martinez':            { slug: 'terraza-martinez',     name: 'Terraza Martínez' },
     // Self-mapping entries force the accented display name to win over a raw-ASCII variant:
     'terraza-martinez':    { slug: 'terraza-martinez',     name: 'Terraza Martínez' },
   };
   ```
5. **Run each raw entry's name through `slugify`** (from `tools/_db.mjs` — it NFD-normalizes accents, L7) and check the merge table. Entries not in the table pass through with `{ slug: slugify(name), name }`. Group by the final slug — natural same-slug entries merge automatically; explicit merges happen via the table.
6. **Before upserting, print the merge table's effect.** List multi-source entries and eyeball them. Any row showing sources from wildly different cuisines or price ranges is probably a false merge — investigate.

**When uncertain, skip the merge.** Two rows that should be one is a small cosmetic issue; one row that should be two is wrong data.

Reference: `tools/_normalize-barcelona.mjs`. Every new city needs its own `_normalize-<city>.mjs` with its own hand-verified merge table.

### 4c · Compose descriptions yourself (Pass 2 — post-enrichment)

This step happens **after** Step 6's enrichment pipeline has populated `data.googleReviews` on every row. Only then do you have the full context to compose.

**Composition is a judgment call, not an algorithm.** Past runs tried to automate this with primary-plus-secondary stitching, similarity-based sentence filtering, credentials-line prefixes, and Reddit codas — all produced robotic output that missed the point (L11). The user said: *"what you should be doing is taking all the summaries and content and figuring out yourself what semantically is the key information relevant to the user and convey that to them succinctly. It shouldn't be like percentage based or anything."*

**The process for each restaurant:**

1. **Read every available source.** For a given entry, gather:
   - Editorial prose from each scrape source (CNT's dek, Eater's review, Time Out's write-up, newspaper reviews, etc.) — from the raw dump files you saved in Step 3
   - Michelin star count if any
   - 50 Best rank + year if any
   - Reddit thread mentions + the actual upvoted comments that named it
   - **Google Places user reviews** (the top ~5, stored on `data.googleReviews`). Every restaurant has these. Dump them via a per-city `_dump-<city>-raw.mjs` helper that queries the DB (see `tools/_dump-barcelona-raw.mjs` for the reference).

2. **Identify what matters.** For a reader on a phone card, what are the 3–5 things they most need?
   - What *kind* of place is it? (Cuisine, concept, setting.)
   - *Why* is it on the list? (Chef pedigree, credentials, signature technique, award.)
   - What should they *order*? (Specific dishes, ideally cross-referenced between sources.)
   - *Practical* info? (Hard to book, lunch-menu bargain, cash-only, no walk-ins, tiny room.)
   - Any *crowd signal* worth surfacing? (r/City calls it the best under-€20; a Google reviewer had memorable framing.)

3. **Write 1–3 tight sentences** in Zagat's voice-neutral, omniscient-narrator register. Use quoted phrases from sources when they're evocative. Don't cite sources inline ("CNT says…" / "Eater adds…") — the source badges on the card already show provenance.

4. **Skip hedges, filler, and algorithmic artifacts**:
   - **No credentials-line prefix** like "Three Michelin stars. A meal at X is…" — weave credentials into the prose naturally: "Three Michelin stars and #1 in World's 50 Best 2024, this El Bulli-alum tasting menu is like a performance…"
   - **No "r/City N mentions." codas.** If Reddit contributed something, weave a phrase or a quote in.
   - **No per-source attribution.** The badges do that.
   - **No character-budget padding.** A 3-sentence entry isn't better than a 1-sentence entry if the 1-sentence version said everything that mattered.

#### Worked example — Disfrutar

**Raw inputs**:
- CNT dek (~900 chars): *"A meal at Disfrutar is like a performance: There's fire, ice, smoke, and lots of flavor and color. What started as an exciting new project by three ex-chefs from the late, great El Bulli has achieved the pinnacle of success in its own right—being awarded three Michelin stars and named the best restaurant in the world, officially, in the 2024 edition of The World's 50 Best Restaurants. … Top dishes include the crispy egg yolk with mushrooms and the chocolate peppers with oil and salt…"*
- Michelin distinction: `THREE_STARS`
- 50 Best: 2024 #1
- Google reviews: *"A masterclass in playful fine dining,"* *"creativity, technique, and storytelling all collide,"* *"founded by three chefs from the legendary El Bulli"*
- Reddit: no mentions

**Composed output** (~400 chars, one paragraph):

> *"Three El Bulli alumni — Mateu Casañas, Oriol Castro, Eduard Xatruch — serving the world's most playful tasting menu, 'like a performance: fire, ice, smoke, and lots of flavor and color.' Three Michelin stars and named #1 in The World's 50 Best Restaurants 2024. Don't miss the crispy egg yolk with mushroom gelatin, the chocolate peppers with oil and salt, or the Beluga-caviar 'panchino' bao. Book months ahead; trust the Classic menu on your first visit."*

What this does:

- **Names the chefs** (pulled from a Google review mention + my own knowledge of the trio).
- **Weaves credentials into the prose** — Michelin + 50 Best are part of the opening sentence, not a separate prefix line.
- **Quotes the memorable phrase** from CNT about fire/ice/smoke.
- **Lists specific signatures** cross-referenced from CNT and Google reviews (the "panchino" bao came from the source prose).
- **Ends with practical advice** — what the user needs to act on this.

### 4d · Storage — per-city descriptions file

Hand-crafted descriptions go in `trips/places/<city>-descriptions.json`, keyed by slug:

```json
{
  "_comment": "Hand-crafted Zagat-style descriptions. Composed by reading every source's raw text + Google reviews and distilling 1-3 sentences per entry.",
  "disfrutar": "Three El Bulli alumni — Mateu Casañas, Oriol Castro, Eduard Xatruch — serving the world's most playful tasting menu…",
  "besta": "Catalonia-meets-Galicia tasting menus from chefs Carles Ramón and Manu Núñez — surf-and-turf pushed to another level…"
}
```

The per-city normalizer's `composeHighlights` is a pure lookup:

```js
const handCrafted = JSON.parse(readFileSync('trips/places/<city>-descriptions.json', 'utf-8'));

function composeHighlights(entry) {
  return handCrafted[entry.id] || fallbackSentenceTruncate(entry);
}
```

Every entry in the city should have a hand-crafted description; the fallback exists only as a safety net.

**Coverage target: 100% of entries in the city.** Every restaurant has Google reviews (L13), so there's always something to compose from — even for Michelin-only entries where no editorial prose exists, the 5 top Google reviews provide 1000+ words of real-diner text that includes signature dishes, service notes, and booking tips.

### 4e · Google reviews aren't a separate UI element

**Do not render `googleReviews` as a distinct block on the card** (L12). They're input to your composition, not output. If a user-review phrase is evocative enough to include, weave it into the single `highlights` paragraph. Otherwise, leave it in `data.googleReviews` (still useful for future re-composition) but don't surface it separately in the webapp.

### 4f · Fallback: sentence-boundary truncation

Only used if no hand-crafted description exists for an entry (rare — should never fire for a city you've composed properly). Reference implementation:

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

Never hard-slice mid-word (L10).

---

## Step 5 — Upsert to Supabase

```bash
node tools/upsert-group-restaurants.mjs <group-id> < normalized.json
```

The script:

1. Inserts a new `discovery_runs` row and gets back `run_id`.
2. For each incoming restaurant:
   - New → insert with `first_seen_run = run_id`, `last_seen_run = run_id`, `status = 'active'`.
   - Existing → **replace** `data.sources` array with incoming sources; **preserve** enrichment fields (`lat`, `lng`, `googleRating`, `googleReviewCount`, `googleReviews`, `openingHours`, `photos`, `photoUrl`, `price`); update `last_seen_run`.
3. Existing rows NOT in the incoming set → set `status = 'removed'`. Keeps votes/comments for audit.
4. Finalizes the `discovery_runs` row with counts + summary.

**Each run is a complete snapshot** (L8). The upsert does not merge source arrays across runs. If the normalizer omits a source that a previous run included, that source attribution goes away — by design, to prevent stale detail-string drift from accumulating. Enrichment fields ARE preserved across runs, so you don't re-spend Google API quota on unchanged restaurants.

**Run this twice**: once in Pass 1 with minimal/empty `highlights`, and again in Pass 2 after composition.

---

## Step 6 — Enrichment pipeline

```bash
node tools/enrich-group-geocode.mjs  <group-id>    # Google Geocoding → lat, lng
node tools/enrich-group-details.mjs  <group-id>    # Places API → rating, reviewCount, openingHours, price, googleReviews
node tools/enrich-group-photos.mjs   <group-id>    # Places API → photos[]
node tools/compute-target-area.mjs   <group-id>    # bbox / center / zoom from geocoded points
```

Or all at once:

```bash
node tools/enrich-group-all.mjs <group-id>
```

Each script is idempotent: reads active rows, fills in its fields, writes back, skips rows that already have the fields unless you pass `--force`.

**Price specifically** uses Google Places' `priceRange.startPrice` (L9) — the older `priceLevel` enum is stale for a non-trivial number of fine-dining restaurants (ABaC returned `INEXPENSIVE` despite being a 3-star). The conversion ladder in `enrich-group-details.mjs` reads `priceRange` first and only falls back to `priceLevel`. Side benefit: `priceRange` has much wider coverage than `priceLevel`.

**Google reviews** are fetched by `enrich-group-details.mjs` via the `places.reviews` field and stored on `data.googleReviews` as `[{author, rating, text, time}, ...]`. This is the input your Pass 2 composition reads.

After this step, target_area / default_center / default_zoom are set on the `groups` row and the webapp can render the map view.

---

## Step 7 — Report to user

```
Discovery run <run-id> complete for <group-id> (<city>):
  Sources scraped:    <editorial list>, Reddit (<N> threads)
  Restaurants:        <total>, <N> multi-editorial-source overlaps
  New / still / removed: <new>/<still>/<removed>
  Enriched:           geocoded <n>/<total>, rated <n>/<total>, priced <n>/<total>, photos <n>/<total>, google-reviews <n>/<total>
  Descriptions:       <n>/<total> hand-crafted, <n> fallback
  Target area:        <bbox>
  Share link:         https://webapp-rust-phi.vercel.app/?g=<group-id>
```

Flag any row with `<n>/<total>` < 100% (outside geo/photo failures on tiny new places Google Places doesn't know). The scrape-completeness check from Step 3 should also be summarized — "Time Out: scraped 10/10, CNT: scraped 34/34, Michelin: scraped 28/?? (verify!)."

---

## Refresh mode (re-runs against an existing group)

Same pipeline, but the normalizer receives a non-empty existing set. The upsert marks missing restaurants as `removed` (keeps votes/comments for audit). Tell the user which places are new and which were retired.

For a refresh, you typically want to:

1. Re-scrape the same sources.
2. Re-run the merge + upsert.
3. Re-run enrichment for new entries (the `--force` flag re-runs for all).
4. Re-compose descriptions for changed entries (or all, if source text shifted).

---

## Common failure modes (red flags to watch for)

Each of these was a real bug in a prior run. When you see one, stop and investigate before committing.

| Symptom | Likely root cause | Fix |
|---|---|---|
| Scraped count < source's advertised count | Pagination missed, click-through failed, or geo-routing | Rescrape; see Step 3 "Verify scrape completeness" |
| Michelin page shows restaurants from another region | Geo-routing to default locale | Google-search for the regional URL |
| Two restaurants merged that shouldn't be | Fuzzy substring matching | Use explicit `CANONICAL_MERGES` table (L6) |
| Same restaurant as two IDs after refresh | `slugify` accent handling | `_db.mjs#slugify` already NFD-normalizes — verify it's the current version |
| Sources array has duplicates with slightly different detail strings | Upsert merging across runs | Already fixed — `upsert-group-restaurants.mjs` replaces sources each run |
| Description ends mid-word | Hard char-slice truncation | Use sentence-boundary truncation (L10) |
| Description reads like a Wikipedia infobox | Algorithmic composition (credentials prefix, primary+secondary stitch, Reddit coda) | Hand-compose (Step 4c) — it's a judgment call |
| $ price on a €260 tasting menu | `priceLevel` enum stale | Already fixed — `enrich-group-details.mjs` uses `priceRange` first |
| Google review pull-quotes on the card | Rendering reviews as UI instead of composition input | Already fixed — `renderCard` doesn't call `renderGoogleReviews` |
| 1-source entries treated as thin data | Forgetting Google reviews are a universal source (L13) | Every entry is multi-source — compose for all of them |
| Reddit skipped entirely | "Blocks headless" framing feels like permission | Reddit is mandatory; `old.reddit.com` works — see Reddit workflow |
| Reddit badge says "3 mentions" but detail lists 11 threads | Universal thread list attached to every reddit source; `mentions` and `threads.length` diverged | Per-restaurant thread attribution via literal substring scan; invariant `mentions === threads.length` (L18) |
| Addresses scraped from source detail pages | Drilling into detail pages for operational data (L5) | Scrape = editorial only; addresses come from Google Places |
| Badges visible in data but not on cards | CSS missing `.badge-<type>` class | Add to `webapp/css/style.css`; there's a neutral fallback but brand color is nicer |

When something new breaks that isn't in this table, add it to `LESSONS.md` with a four-part entry (what happened / root cause / consequence / skill mitigation) and update the relevant Step here so the fix sticks.

---

## Related files

- **`LESSONS.md`** (next to this file) — detailed root-cause log. Read it before starting.
- **`tools/_db.mjs`** — shared Supabase REST helper + `slugify` (NFD-normalized).
- **`tools/create-group.mjs`** — CLI to create a `groups` row.
- **`tools/get-group.mjs`** — print a group row by id.
- **`tools/upsert-group-restaurants.mjs`** — stdin-driven upsert; replaces sources, preserves enrichment.
- **`tools/enrich-group-{geocode,details,photos}.mjs`** — enrichment steps; all `--force`-able.
- **`tools/enrich-group-all.mjs`** — runs the four enrichment steps in order.
- **`tools/compute-target-area.mjs`** — bbox/center/zoom from geocoded points.
- **`tools/_normalize-barcelona.mjs`** — reference per-city normalizer (merge table, text cleanup, descriptions lookup).
- **`tools/_dump-barcelona-raw.mjs`** — reference dump script for composing Pass 2.
- **`trips/places/barcelona-descriptions.json`** — reference hand-crafted descriptions file.
- **`webapp/supabase/migrations/20260411000000_groups.sql`** — schema source of truth.
