# Lessons learned — discover-restaurants

A running log of every issue caught during real discovery runs, the root cause, and how the skill now prevents the same class of mistake. When fixing a new problem, add an entry here AND update SKILL.md so the guidance compounds.

Format per lesson: **what happened → root cause → consequence → skill mitigation**. If a fix required code outside the skill's text (e.g., a utility function), note the file.

---

## L1 · Reddit skipped because the skill framed it as risky

**What happened** — First Barcelona run scraped Time Out, CNT, Michelin, Eater, and 50 Best but skipped Reddit entirely. The then-current skill listed Reddit under "crowd wisdom" with a "Reddit often blocks headless browsers" note and a fallback ladder (Google cache, snippet extraction, etc.) that made it feel optional.

**Root cause** — Defensive documentation creates permission to skip. Any step with a pre-baked escape hatch will be taken.

**Consequence** — The Barcelona list missed **Xerta** (a 1-star Michelin restaurant the Michelin scrape *also* missed), **Yakumanka** (Gastón Acurio's Peruvian flagship), **El Pachuco** (beloved cheap Mexican), **Bar H** (legendary €7.50-a-plate Italian hole-in-the-wall), and **Dos Pebrots** (Albert Raurich's ex-Tickets concept). Hidden gems are exactly what Reddit is for; we missed all of them by skipping it.

**Skill mitigation** — Reddit is documented as **mandatory**, same tier as the ≥3 editorial lists. No fallback ladder, no "blocks headless" caveats. The path is `old.reddit.com` via Playwright MCP, and it works. See Step 2 (source picking) and Step 3 (Reddit workflow).

---

## L2 · Preferring state-blob extraction over click-through

**What happened** — CNT's "34 Best Restaurants in Barcelona" uses a lazy-loaded gallery that only renders one entry in the DOM at a time. Instead of using `browser_click` to walk through, I read `window.__PRELOADED_STATE__.transformed.gallery.items` and got all 34 in one shot.

**Root cause** — State blobs feel like a clever shortcut, but they only expose what the site's engineers chose to hydrate into client state. The rendered DOM sometimes has more.

**Consequence** — Non-fatal because the scrape/enrich boundary (L5) means address/hours/price come from Google Places anyway. But the user correctly flagged that I should have just clicked through.

**Skill mitigation** — Step 3 names `browser_click` as the preferred pagination method. `__PRELOADED_STATE__` / `__NEXT_DATA__` / `__INITIAL_STATE__` are documented as a fallback, "not a first resort — state blobs can miss fields the rendered DOM has."

---

## L3 · Scrape completeness not verified (Michelin missed Xerta)

**What happened** — My Michelin Guide scrape for Barcelona returned 28 starred restaurants and I moved on. A subsequent Reddit thread mentioned **Xerta**, a 1-star Michelin restaurant — which my Michelin scrape *should* have returned but didn't. I never validated the count.

**Root cause** — No completeness check. I trusted the scrape output without comparing to a reference.

**Consequence** — Xerta was missing from the list until Reddit cross-referenced it in. Any restaurant that's in Michelin's data but not on the page I scraped was silently dropped.

**Skill mitigation** — Step 3 now has an explicit "Verify scrape completeness" rule: compare your count to the source's advertised count (e.g., "The 38 Best" → expect 38), and if they don't match, investigate before committing. Michelin-specifically: the all-starred list for a major European capital should have 25-50+ entries; if you got fewer than expected, check for pagination, geo-routing, or missing regions.

---

## L4 · Michelin Guide geo-routing

**What happened** — First Michelin URL I tried (`guide.michelin.com/en/catalonia/es-barcelona/restaurants`) returned cached Chinese restaurants (Zhejiang province) because the site geo-routes or falls back to a default region.

**Root cause** — Michelin's URL structure redirects based on user region or browser location defaults.

**Consequence** — Wasted a scrape. Had to Google-search for the correct regional URL.

**Skill mitigation** — Step 2 (Michelin source description) documents the geo-routing behavior and the workaround: "If the page shows results from a different region, it's geo-routing — search Google for `"guide.michelin.com" <city> all-starred` and use the regional URL Google surfaces."

---

## L5 · Scrape-for-operational-data ambiguity (address, hours, price)

**What happened** — Early runs were unsure whether to drill into per-restaurant detail pages on source sites to capture addresses, phone numbers, opening hours, and price. The CNT state blob I extracted from didn't have addresses, prompting the question: should I click through to each CNT detail page?

**Root cause** — The skill didn't have a clean scrape/enrich boundary rule, so the scraper's job was implicitly open-ended.

**Consequence** — Wasted effort on a data layer that Google Places owns authoritatively. Risk of stale/wrong operational data (Google's scrape is always fresher than an editorial site's static copy).

**Skill mitigation** — Step 3 opens with an explicit "What the scrape is for (and what it is NOT for)" section. The scrape captures **name + editorial prose + source attribution**. Everything operational (`address`, `price`, `openFor`, `website`, `lat`, `lng`, `googleRating`, `googleReviewCount`, `openingHours`, `photos`, `photoUrl`, `googleReviews`) is enrichment-owned. Explicit rule: "Do not drill into per-restaurant detail pages on source sites to extract structured venue data."

---

## L6 · Fuzzy substring matching caused a false-positive merge

**What happened** — My cross-source dedup used a content-word substring similarity: `"rectangle".includes("angle")` returned true, so El Rectangle (a Time Out restaurant) got falsely merged with Angle (a 1-star Michelin restaurant). Angle's Michelin credentials ended up on El Rectangle's card in the production deploy.

**Root cause** — Heuristic text matching is unsafe for restaurant name deduplication. Short embedded substrings fire false positives; content-word unigram overlap fires on shared generic nouns.

**Consequence** — Wrong credentials on the wrong restaurant. User caught it: "shouldn't this just be michelin if it's on the michelin list?"

**Skill mitigation** — Step 4's "Cross-source merging" section opens with the El Rectangle/Angle story as the motivating example. The rule: do the merge by judgment, not by algorithm. Per-city normalizer has an explicit `CANONICAL_MERGES` table keyed by raw slug → canonical `{slug, name}`. Every entry in the table is a human judgment call. When uncertain, skip the merge — two rows that should be one is cosmetic; one row that should be two is wrong data.

---

## L7 · slugify didn't NFD-normalize accents

**What happened** — "Bar Canyí" was hand-written as `bar-canyi` in the original seed data, but slugify produced `bar-cany` (because the old version mapped `í` to a hyphen). When I re-upserted, the same restaurant ended up with two different IDs in the DB.

**Root cause** — slugify transformed accented characters to hyphens rather than their ASCII equivalents.

**Consequence** — Duplicate rows on refresh whenever source data had accents. Also made the per-city canonical-merge table brittle (I had to handle `come-by-paco-m-ndez` vs `come-by-paco-mendez` as separate map keys).

**Skill mitigation** — `tools/_db.mjs` slugify now does NFD decomposition + diacritic stripping before the hyphen-conversion pass. "Bar Canyí" → `bar-canyi`. "COME by Paco Méndez" → `come-by-paco-mendez`. Step 4's canonical schema section mentions: "slugs are NFD-normalized ASCII — don't hand-write IDs assuming accented characters pass through unchanged."

---

## L8 · Upsert merged sources across runs → stale duplicates

**What happened** — The upsert script merged the incoming `sources` array with the previous run's sources. When the detail string format changed between runs (e.g., `"The World's 50 Best Restaurants — #1 in 2024"` → `"The World's 50 Best Restaurants 2024 #1"`), both versions accumulated on the same row.

**Root cause** — Merge-union instead of replace. The dedup check compared `type + detail` for exact string equality, so near-duplicates with different formatting snuck through.

**Consequence** — Disfrutar ended up with 4 sources visible on the card when it should have 3. Every format tweak caused more accumulation on subsequent runs.

**Skill mitigation** — `tools/upsert-group-restaurants.mjs` now **replaces** the `sources` array each run. Enrichment fields (lat/lng, googleRating, googleReviews, openingHours, photos, photoUrl, price) are still preserved. Skill Step 5 documents this: "Each run is a complete snapshot. The upsert does not merge sources across runs."

---

## L9 · Google Places `priceLevel` is stale for many restaurants

**What happened** — ABaC (3-star Michelin, €260 tasting menu) showed as `$` on the card. Google Places API returned `priceLevel: "PRICE_LEVEL_INEXPENSIVE"` — almost certainly a stale user-submitted data point. The newer `priceRange` field returned `startPrice: { currencyCode: "EUR", units: "100" }` which is clearly `$$$$`.

**Root cause** — The enrichment script read only `priceLevel` (old enum) and ignored `priceRange` (newer structured monetary data).

**Consequence** — ABaC bucketed as `$`. Probably other fine-dining spots too. User noticed for ABaC specifically.

**Skill mitigation** — `tools/enrich-group-details.mjs#parsePrice` reads `priceRange.startPrice` first, converts to USD via a ~20-currency table, buckets into `$/$$/$$$/$$$$`, and only falls back to the `priceLevel` enum when `priceRange` is absent. Side benefit: `priceRange` has much wider coverage than `priceLevel` (Barcelona with-price went from 61/90 to 88/90 after the fix). The skill notes in Step 6 that the enrichment pipeline uses `priceRange` as the primary source.

---

## L10 · Hard character truncation cut descriptions mid-word

**What happened** — Disfrutar's composed description ended with "…sending our taste buds a completely differen" — the last few characters of a word. My composer used `.slice(0, 500)` to cap length.

**Root cause** — Character-boundary truncation instead of sentence-boundary truncation.

**Consequence** — Visible mid-word cutoff on the card. Looked unprofessional.

**Skill mitigation** — The reference `sentenceTruncate` helper in `tools/_normalize-barcelona.mjs` picks whole sentences up to the budget and never mid-word-truncates. Skill documents this in the fallback section. More importantly, hand-crafted descriptions (the primary path) don't need truncation at all — the author writes to the right length directly.

---

## L11 · Algorithmic composition produced robotic output

**What happened** — My composition pipeline used a primary-narrative-plus-secondary-stitching approach with a content-word unigram similarity filter, a credentials-line prefix ("Three Michelin stars; World's 50 Best #1 (2024).") and a Reddit coda ("r/Barcelona 2 mentions."). The output was a run-on concatenation that read like a Wikipedia infobox stapled to a long CNT excerpt.

**Root cause** — Trying to automate something that requires judgment. Algorithms can pick and concatenate text, but they can't distill what's actually worth surfacing to a reader on a phone card.

**Consequence** — User said "I don't like the summaries. what you should be doing is taking all the summaries and content and figuring out yourself what semantically is the key information relevant to the user and convey that to they succinctly. It shouldn't be like percentage based or anything."

**Skill mitigation** — Step 4 was rewritten with one rule: **composition is a judgment call, not an algorithm**. No credentials-line prefix, no primary/secondary split, no similarity filtering, no Reddit coda. Read all available sources + Google reviews, identify what matters, write 1-3 tight sentences in Zagat's voice-neutral register, weaving credentials and quoted phrases naturally into the prose. Step 4 has a worked example on Disfrutar showing raw inputs → composed output with annotations.

---

## L12 · Google reviews rendered as a separate UI block

**What happened** — I added a `renderGoogleReviews` function to the webapp that rendered 1-2 pull-quotes below each card's description. The user said this was wrong: "you shouldn't use google reviews directly like that, just incorporate them if relevant into the summary."

**Root cause** — Treating Google reviews as a data layer visible to users rather than as input to the composition.

**Consequence** — Cards had redundant voice layers: editorial prose, then italic pull-quotes from random Google users, which often repeated things the editorial already said.

**Skill mitigation** — Step 4 now has an explicit "Google reviews aren't a separate UI element" rule: they're composition input, not UI output. `enrich-group-details.mjs` still fetches and stores `googleReviews` (for the composer to read), but the webapp's `renderCard` no longer surfaces them separately. If a user-review phrase captures something the editorial missed (a specific dish, a booking tip, memorable framing), it gets woven into the single `highlights` paragraph.

---

## L13 · "Single-editorial-source = thin data" fallacy

**What happened** — I treated entries with only one editorial source as thin and only hand-crafted 33 descriptions initially (the 26 multi-editorial entries plus 7 new Reddit finds). The user pushed back: "shouldn't you have multiple sources for nearly everything with the google reviews too?"

**Root cause** — Wrong mental model of what counts as a "source." I was counting only editorial scrape sources, not the fact that Google Places reviews exist for essentially every restaurant.

**Consequence** — Two-thirds of Barcelona cards were still running off auto-composed text from a single editorial source when they could have been hand-crafted with Google-reviews input.

**Skill mitigation** — Step 4 explicitly reframes: **every restaurant is multi-source**, because Google reviews exist for all of them. Treat every entry as having editorial content (1+ sources) + user voice (Google reviews) + any credentials. Hand-craft all entries.

---

## L14 · Text dirt in CMS prose (HTML entities, Kramdown, markdown links)

**What happened** — CNT's `dek` content came with raw `&nbsp;`, `&amp;`, Kramdown link attribute annotations like `{: target="_blank"}`, and markdown-style inline links like `[The World's 50 Best Restaurants](https://www.theworlds50best.com/...)`. All of it leaked into the rendered cards until I cleaned them up over two rounds of fixes.

**Root cause** — Different CMS platforms (Kramdown-on-Hugo, old WordPress, Next.js MDX) leave different residue in their content. There's no single "clean" HTML/markdown output.

**Consequence** — Cards read with visible `&nbsp;`, broken markdown syntax, and unprocessed link attribute blocks. User had to point it out each time.

**Skill mitigation** — Step 4 lists text-cleanup rules explicitly: strip HTML entities (`&nbsp;`, `&amp;`, `&apos;`, `&rsquo;`, `&lsquo;`, `&rdquo;`, `&ldquo;`, `&mdash;`, `&ndash;`), collapse markdown-style inline link syntax `[text](url)` → `text`, strip Kramdown attributes `{: target="_blank"}`, collapse `**bold**` markers, normalize whitespace. Reference implementation in `tools/_normalize-barcelona.mjs#unesc`. Every new city's normalizer should start from this pattern.

---

## L15 · Pipeline ordering: compose happened before enrichment could populate Google reviews

**What happened** — My initial normalizer composed `highlights` as part of the first upsert pass. Since Google reviews come from the enrichment step (which runs AFTER the first upsert), the composer couldn't read them. I ended up doing a second-pass refactor after the user pointed out that Google reviews should inform descriptions.

**Root cause** — I had an implicit single-pass mental model (scrape → compose → upsert → enrich), when the correct flow is two-pass: scrape → **initial** upsert → enrich → read enriched data → hand-craft descriptions → **re-upsert** with descriptions.

**Consequence** — Had to tear out the algorithmic composer, refactor the normalizer to load a per-city descriptions JSON, dump raw data (editorial + Google reviews from DB), hand-craft 97 descriptions, and re-upsert. Significant rework.

**Skill mitigation** — New "Pipeline order" section at the top of the skill (between Preconditions and Step 1) documents the two-pass workflow explicitly. First pass does scrape + initial upsert + enrichment. Only after enrichment runs do you have Google reviews available for composition. Then dump the raw data with a per-city `_dump-<city>-raw.mjs` helper (modeled after `_dump-barcelona-raw.mjs`), hand-craft descriptions into `trips/places/<city>-descriptions.json`, and re-upsert. The skill's reference implementation (`_normalize-barcelona.mjs`) loads the descriptions file as a lookup table.

---

## L16 · CSS missing fallback background for new badge classes

**What happened** — After adding new source types (`timeout`, `michelin`, `50best`, `newspaper`, `local_blog`), cards with multiple sources only showed the first badge. It looked like a rendering bug; debugging revealed that `.badge` had `color: #fff` but no background fallback, and the new classes had no CSS rules. The badges were rendering, but as invisible white text on a transparent background.

**Root cause** — Adding a new source type requires a webapp CSS update that wasn't automatic.

**Consequence** — A 3-source entry (e.g., Disfrutar with cnt+michelin+50best) looked like a 1-source entry on the card. Took debugging in the DB and the CSS to identify.

**Skill mitigation** — Out of skill scope (webapp concern), but the CSS now has a neutral `.badge` fallback background so any new type renders at least legibly. The skill's "related" section points at the set of known source types. Noted here for future-self: when introducing a new source type, grep for existing `.badge-*` rules in `webapp/css/style.css` and add a matching color.

---

## L17 · Webapp create-group flow was a dead end

**What happened** — The early picker had a "Create new group" button that inserted a `groups` row and redirected to `/?g=<token>`. But discovery needs Playwright MCP + Claude + Google API key, none of which live in a static SPA. Users who clicked Create got an empty group and no way to populate it.

**Root cause** — Misjudged architecture. The picker seemed like a natural place to create groups, but creating is an operator action that can't happen in the browser.

**Consequence** — Half-broken UX, user flagged it as a dead-end flow.

**Skill mitigation** — Groups are created **exclusively** via `tools/create-group.mjs` or by this skill (which wraps that tool when given a city name instead of a group id). The webapp picker is read-only. Documented in Step 1 and in CLAUDE.md's "Group lifecycle" section.

---

## L18 · Reddit `mentions` count and `threads[]` list got out of sync

**What happened** — The SD group showed "3 Reddit mentions" on The Marine Room's badge but listed 11 threads in the detail view. Other rows had the same inconsistency. The original SD scrape stored a `mentions` count derived from Google-snippet heuristics (e.g. "Marine Room appears in ~3 thread snippets"), and a later retrofit script attached the full universal 11-thread list to *every* reddit source regardless of which threads actually mentioned each restaurant. The two numbers came from different sources and never had to agree.

**Root cause** — Two things at once:
1. Attaching a universal thread list to every reddit source ("these are the threads we scraped") instead of a per-restaurant list ("these are the threads that mention *this* restaurant").
2. Not reconciling `mentions` with `threads.length` — they're both "how many threads cited this restaurant" but one came from Google-snippet matching and the other from bulk attachment.

**Consequence** — Detail view showed 11 threads for a restaurant the scrape said only had 3 mentions. Self-contradictory UI, user caught it immediately. Also 13 of 24 restaurants had unverified mentions counts pointing at threads where they weren't actually named — those shouldn't have claimed Reddit as a source at all.

**Skill mitigation** — Step 3 Reddit workflow now explicitly requires per-restaurant thread attribution:
- For each restaurant, scan the actual saved thread files (`reddit-thread-<N>.json`) with literal substring matching (case-insensitive, plus hand-curated aliases for short forms like "George's" for "George's At The Cove"), and populate `sources[].threads[]` with only the threads that mention it.
- Set `sources[].mentions = threads.length` so badge count and detail thread list always agree. These fields must never diverge — they're two views of the same underlying count.
- If no thread mentions a restaurant, **do not attach a reddit source to it at all** — an unverifiable "N Reddit recs" badge is worse than no badge.
- Never attach a "universal threads list" to all restaurants. The threads list is per-restaurant ground truth.

Reference: `tools/_retrofit-sd-reddit-threads.mjs` shows the matching pattern (candidates with aliases → literal substring scan → reconcile mentions with threads.length → drop source when no match).

---

## Adding a new lesson

When a new run catches a mistake not covered above:

1. Add a numbered entry here with the four-part structure (what / root cause / consequence / skill mitigation).
2. Update `SKILL.md` in the relevant step so the rule fires at the right point in the workflow.
3. If the fix required code outside this skill (a helper, a CSS rule, a schema change), note the file.
4. If the lesson overlaps with an existing one, consolidate rather than adding a near-duplicate.

The goal is a skill that compounds — every real-world run makes the next one faster, not just the same.
