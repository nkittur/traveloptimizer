---
name: discover-summer-camps
description: Build a ranked, source-verified shortlist of summer programs/camps for a teen on college campuses within driving distance of one or more home anchors (e.g. Pittsburgh, Chicago, Madison). Mines official college summer-program pages and trusted aggregators (JKCF, TeenLife, NACAC) with Playwright MCP, applies hard filters (date-window fit, age/grade eligibility, multi-anchor drive radius, deadline status, residential format, cost cap), scores survivors against a weighted rubric (prestige, fit-to-interests, daughter-fit, dates-clean-fit, social-value, independence-balance, cost-value), then hand-composes long-form write-ups for the top 8–12. Outputs a markdown report + JSON ground truth at searches/<search-id>/. Triggered when the user says "find summer camps for <person>", "look for pre-college programs near <city>", "summer 2026 programs for <teen>", or similar.
user-invocable: true
argument-hint: "<search-id> | <new search request>"
---

Pick summer programs / pre-college camps for a teen. Sibling of `discover-destinations` and `discover-restaurants` — same multi-source verification discipline and two-pass philosophy, but the unit of work is a **program** (named offering with dates, host campus, eligibility, deadline), not a city or a venue. Output is a **markdown report + JSON ground truth at `searches/<id>/`** (V1: no Supabase, no webapp render).

**Read the sibling skills first**: `../discover-restaurants/SKILL.md`, `../discover-destinations/SKILL.md`. This file documents the **camp-specific differences**, not the shared scrape/normalize/compose discipline (which lives in those siblings).

**Read this skill's companions before starting:**
- `LESSONS.md` (next to this file) — seeded with the dragons I already saw in design. **Read first.** Every lesson in there is a write-up I want to never repeat.
- `SOURCES.md` (next to this file) — curated per-anchor list of campuses within ~3hr drive + aggregators + forums. The seed source set.

---

## What's different from the sibling skills

| Concept | Restaurants / Activities / Destinations | Summer Camps |
|---|---|---|
| Unit of work | A venue (restaurant) or city (destination) | A **program** at a campus, with specific dates |
| Origin | A single airport (PIT) | **Multi-anchor** drive radius (PIT, ORD, MSN) |
| Time | Year-round | **A specific year's specific dates** must fit **inside** the user's available windows |
| Eligibility | None | Age and grade-rising have to be normalized to a canonical shape (L1) |
| Operational data | Address, hours, price, lat/lng | Dates, deadline status, format (residential vs commuter), all-in cost, application URL |
| Year-currency | Implicit (restaurants don't change yearly) | **Cardinal rule (L0):** every program must trace to a year-current source |
| Composition voice | Zagat-omniscient (restaurants) / travel-guide (activities) / trip-report (destinations) | **Trusted-advisor**: what it IS, who it's for, what to expect, one practical caveat |
| Output target (V1) | Supabase + webapp render | `searches/<id>/report.md` + JSON only |

The **cardinal rule** for this skill: every program in the report must trace back to a real, year-current source. Stale listicles are full of programs that no longer exist (L0, L7). Verify against the official college page for the search year; if you can't, the program goes to the rejected appendix.

---

## Inputs

The search is parameterized by `searches/<id>/config.json`. Either:

- **Existing search id** → load `searches/<id>/config.json` and continue.
- **New search** → ask the user for the inputs below, then scaffold via `tools/create-camp-search.mjs`.

Ask interactively (don't guess) for any missing field:

| Field | Default | Notes |
|---|---|---|
| `id` | (required) | Short slug like `ashi-summer-2026`. |
| `person` | `ashi` | Ghostwheel slug. Used by `_load-travel-context.mjs` for preferences. |
| `age` | `14` | Age at the start of the program window. |
| `rising_grade` | `10` | Grade-rising = the grade the person enters in the fall after the program. Programs encode eligibility four ways (L1); the normalizer translates to this canonical scalar. |
| `year` | current year + 1 if past March | Calendar year of the programs. |
| `anchors` | `[PIT, ORD, MSN]` | Three-letter airport-style codes for the home jumping-off points. Must exist in `SOURCES.md` or the geo filter has nothing to compare against. |
| `max_drive_hours` | `3` | Per-anchor drive ceiling. Geo filter is "**any** anchor within range" (L3 — it's union, not intersection). |
| `available_windows` | `[<year>-06-01..<year>-07-10, <year>-08-01..<year>-08-31]` | One or more date ranges. A program fits iff `program.start >= window.start AND program.end <= window.end` for **some** window (L2 — total-fit, not overlap). |
| `interests` | `[]` (ask interactively) | Topic tags: `creative-writing, design, coding, art, journalism, music, theatre, film, debate, business, leadership, STEM, math, science, sports, etc.` Empty = broad search. |
| `format` | `any` | `residential | commuter | any`. Residential further subdivided in L5; capture the dorm-vs-apartment-vs-host nuance at finalist time. |
| `cost_cap_usd` | `null` (surface all, flag expensive) | All-in cost cap (L6). |

**Scaffold the search:**

```bash
node tools/create-camp-search.mjs \
  --id ashi-summer-2026 \
  --person ashi --age 14 --rising-grade 10 --year 2026 \
  --anchors PIT,ORD,MSN --max-drive-hours 3 \
  --windows "2026-06-01..2026-07-10,2026-08-01..2026-08-31" \
  --interests "creative-writing,design,journalism" \
  --format any --by Niki
```

Writes `searches/ashi-summer-2026/config.json` and creates the `raw/` subdir.

---

## Preconditions

1. **Playwright MCP available.** Every official campus page is JS-rendered (modern CMS) or login-gated. `mcp__playwright__browser_*` is the only sanctioned scraper. Never WebFetch a college program page — they all break.
2. **Claude in Chrome available** for login-gated application portals (some programs hide deadlines behind a portal that needs an account). Used in Pass 2 only.
3. **Ghostwheel reachable** for person preferences via `tools/_load-travel-context.mjs`. The travel-context loader works for any ghostwheel slug, not just the family-trip default trio.
4. **SOURCES.md anchors cover the search.** If the user gives an anchor that isn't in SOURCES.md, **stop and add it** before proceeding — the geo filter has nothing to compare against otherwise.

---

## Pipeline order — two passes (ported from siblings)

```
 Pass 1 (gather + filter + score):
   Step 1  Load search config + person preferences from ghostwheel
   Step 2  Pick sources (campus pages + aggregators + forums)
   Step 3  Scrape via Playwright MCP, save raw dumps
   Step 4  Normalize + cross-source merge → programs.json with status='candidate'
   Step 5  Hard filters → mark rejected with reason (mark, never delete)
   Step 6  Score survivors against weighted buckets → pick top 8–12 finalists

 Pass 2 (drill into finalists, then compose):
   Step 7  For each finalist: drill into the official page + forum reviews
           · verify dates against the page footer / URL year
           · verify deadline against the application portal (L4)
           · verify housing reality (L5)
           · verify all-in cost (L6)
           · pull first-person reviews from forum threads
           → save <slug>-mentions.json per finalist
   Step 8  Hand-compose 1–2 paragraph write-up per finalist
   Step 9  Render report.md + finalize programs.json
   Step 10 Report to user with the file path + summary
```

**Why two passes?** The same reason as the sibling skills: Pass 1 gathers a wide net cheaply (mostly text scraping), Pass 2 spends the expensive verification time (per-site drill-in, portal logins, deadline checks) only on the survivors that scored well enough to matter. Drilling into 80 candidates is wasted work; drilling into 10 finalists is exactly right.

---

## Step 1 — Load search + person preferences

```bash
cat searches/<id>/config.json                            # the search spec
node tools/_load-travel-context.mjs <config.person>      # ghostwheel pull
```

The ghostwheel pull surfaces the person's `## Travel`, `## Food`, and free-text profile, plus shared `preferences/travel.md` and `preferences/food.md`. For Ashi specifically, the profile (`../ghostwheel/data/people/ashi.md`) is the source of truth for "cities, urban energy, walkability, aesthetic / Instagrammy" — that biases scoring (a program at Northwestern Evanston scores higher on `daughter_fit` than one at Geneva College in Beaver Falls).

**Do not duplicate person preferences in this repo.** If `config.person`'s profile is missing a preference relevant to camp picking (e.g., "loves hands-on building" vs "prefers seminar discussion"), add it to ghostwheel first.

---

## Step 2 — Pick sources

The **source budget** is shaped by the search:

- **Per-anchor campus pages** — for every campus in `SOURCES.md` within `max_drive_hours` of any anchor in `config.anchors`. This is your **first and most authoritative pass**: official college pages are the year-currency oracle (L0, L7).
- **Aggregators** — TeenLife (broad), **JKCF Summer Opportunities List** (highest-trust curated), NACAC, plus 1–2 prestige listicles for cross-reference. **Skew lower-prestige aggregators for younger searches (L9)** — for rising 9–10 the prestige aggregators are mostly age-mismatched.
- **Forums (mandatory)** — at least r/ApplyingToCollege + r/precollege + a host-school subreddit per finalist campus. Forums are where you find out what the program is actually like; the marketing page tells you what it is supposed to be (L8).

**Rejection criteria (ported from siblings):**

- AI content farms (no author bio, generic prose).
- SEO listicles ("Top 20!!!" with no editorial voice).
- Stale archives (>2yr) unless used as historical reference.
- Online-only programs (out of scope).
- Sports-only camps (out of scope unless `interests` includes `sports`).
- Programs with no clear dates for `config.year` — investigate one level deeper before dropping (sometimes dates are in a PDF or behind a form), but don't keep them on faith.

See `SOURCES.md` for the full list keyed by anchor + the rejection criteria.

---

## Step 3 — Scrape with Playwright MCP

The scrape rules are the same as `discover-restaurants/SKILL.md` Step 3 — read that first, especially:

- Navigate → snapshot → click through pagination/expanders → fall back to `__PRELOADED_STATE__` only when click-through fails.
- **Verify scrape completeness** — if a campus's "Pre-College Programs" page says "23 programs" and you scraped 7, something's wrong. Re-check pagination.
- **Save raw to disk** as `searches/<id>/raw/<source>-<campus>-raw.json` (e.g., `searches/ashi-summer-2026/raw/cmu-pre-college-2026-raw.json`). Composition reads these.
- **Strip CMS residue** via the `unesc()` pattern from `tools/_normalize-barcelona.mjs#unesc`.

### What the camps scrape captures (per program)

```json
{
  "name": "Pre-College Architecture",
  "host_institution": "Carnegie Mellon University",
  "host_city": "Pittsburgh, PA",
  "topic_tags_raw": ["architecture", "design", "studio"],
  "dates_raw": "June 22 – July 31, 2026",
  "duration_raw": "6 weeks",
  "format_raw": "Residential — on-campus housing in Donner Hall",
  "eligibility_raw": "Rising 11th–12th graders, ages 16+",
  "cost_raw": "$8,500 tuition + $1,800 housing + $400 fees",
  "deadline_raw": "Applications close January 5, 2026",
  "url": "https://www.cmu.edu/pre-college/academic-programs/architecture.html",
  "page_last_updated": "2026-01-15",   // from footer / meta if present
  "url_year_token": "2026",            // any year-encoded segment of the URL
  "description_raw": "<long prose>",
  "source_year": 2026                  // year the source itself dates to
}
```

The `*_raw` fields are deliberately not parsed yet — the normalizer in Step 4 owns parsing. The reason is L1/L2/L6: parsing eligibility/dates/cost is a translation problem with subtle dialects, and keeping the raw string around lets the user audit the translation.

### Forum scrape pattern (ported from restaurants)

For each finalist campus's host-school subreddit, plus r/ApplyingToCollege and r/precollege:

1. Google for threads — `site:reddit.com/r/<sub> "<program name>"` or `site:reddit.com/r/<sub> "pre-college"`.
2. Use `old.reddit.com` (Playwright-friendly).
3. Extract comments with scores via `browser_evaluate` (same recipe as restaurants Step 3).
4. Save as `searches/<id>/raw/reddit-<program-slug>-thread-<N>.json`.
5. Per-program thread attribution is mandatory (port L18 from restaurants). For each candidate program, the normalizer scans saved thread blobs for the program's name (with hand-curated aliases — "Cherubs" for "Medill-Northwestern Journalism Institute") and attaches ONLY the threads that mention it. Invariant: `sources[].reddit.mentions === sources[].reddit.threads.length`.

---

## Step 4 — Normalize + cross-source merge

The normalizer translates each program from raw scrape shape to canonical shape. **Programs are not restaurants** — there is no per-city normalizer file; instead, write one per-search normalizer at `searches/<id>/_normalize.mjs` that handles the campuses in that search's anchors.

### Canonical program shape

```json
{
  "slug": "cmu-pre-college-architecture-2026",
  "name": "Pre-College Architecture",
  "host_institution": "Carnegie Mellon University",
  "host_city": "Pittsburgh, PA",
  "host_lat_lng": [40.4433, -79.9436],
  "nearest_anchor": { "code": "PIT", "drive_hours": 0.0 },
  "topic_tags": ["architecture", "design", "art"],
  "format": "residential-dorm-supervised",
  "eligibility": { "min_age": 16, "max_age": 18, "min_grade_rising": 11, "max_grade_rising": 12 },
  "eligibility_uncertain": false,
  "sessions": [
    { "label": "Summer 2026", "start": "2026-06-22", "end": "2026-07-31", "duration_weeks": 6, "fit": false, "fit_reason": "spans Jul 11+" }
  ],
  "any_session_fits": false,
  "cost": {
    "tuition_usd": 8500, "room_board_usd": 1800, "fees_usd": 400,
    "all_in_usd": 10700,
    "what_is_included": "instruction, housing, meals", "what_is_not_included": "supplies, transportation",
    "scholarships_available": true, "source_url": "..."
  },
  "cost_complete": true,
  "application": {
    "url": "https://...",
    "deadline_iso": "2026-01-05",
    "status": "closed",
    "status_verified_at": "2026-05-14",
    "status_source": "application-portal"
  },
  "url": "https://www.cmu.edu/pre-college/academic-programs/architecture.html",
  "status": "candidate",
  "rejection_reason": null,
  "scores": {},
  "composite_score": null,
  "ranking": null,
  "highlights": null,                     // composed in Step 8
  "sources": [
    { "type": "official", "url": "...", "title": "CMU Pre-College — Architecture", "source_year": 2026, "verified_year_current": true },
    { "type": "teenlife", "url": "...", "title": "...", "source_year": 2026 },
    { "type": "reddit", "threads": [...], "mentions": 2, "detail": "r/cmu — 2 threads" }
  ]
}
```

### Translation discipline (L1 / L2 / L4 / L5 / L6)

The normalizer implements these translations explicitly — they are not optional:

**Eligibility (L1):**

```js
// "completed Nth grade"  → min_grade_rising = N + 1
// "rising Nth"           → min_grade_rising = N
// "currently in Nth"     → min_grade_rising = N + 1  (post-school-year reading)
// "ages N+"              → min_age = N
function normalizeEligibility(raw) { /* …explicit dialect translator… */ }
```

When the page is genuinely ambiguous, set `eligibility_uncertain: true` and capture the literal phrase in `eligibility_raw_phrase`. The renderer surfaces these to the user as "verify by emailing admissions."

**Dates (L2):** parse `dates_raw` to one or more `sessions[]`. Total-fit only:

```js
function sessionFits(session, windows) {
  return windows.some(w => session.start >= w.start && session.end <= w.end);
}
```

A program is eligible if **any** session fits. Reject programs where no session fits at all; surface the individual session statuses in `sessions[].fit_reason` so the user can see exactly why.

**Cost (L6):** parse all components, compute `all_in_usd = tuition + room_board + fees`. If only tuition is published, set `cost_complete: false` and surface "verify housing/fees with admissions."

**Format (L5):** map to one of `residential-dorm-supervised | residential-dorm-unsupervised | residential-offsite | commuter | hybrid`. When the page just says "residential" without housing detail, set `housing_uncertain: true` and check in Pass 2.

### Cross-source merging (port from restaurants Step 4b)

Same discipline: **enumerate every unique raw name, identify merge pairs by judgment, build an explicit `CANONICAL_MERGES` table in `_normalize.mjs`.** Do not fuzzy-substring-merge — same-host programs with similar names get falsely merged ("Pre-College Architecture" vs "Pre-College Design" at CMU are different).

The merge axis here is **(host_institution, program_name)**. Two raw entries merge iff they refer to the same offering at the same campus. Different programs at the same campus do not merge; the same program from official + TeenLife + Reddit does.

### Save Pass 1 output

```bash
node searches/<id>/_normalize.mjs > searches/<id>/programs.json
```

`programs.json` is the canonical store from here on. Pass 2 re-reads and re-writes it.

---

## Step 5 — Apply hard filters

Read `searches/<id>/config.json`. For each program, run the filters in this order, **stopping at the first that fails** (the order matters for clear rejection_reason attribution):

| Order | Filter | Pass condition | Rejection reason |
|---|---|---|---|
| 1 | `verified_year_current` | At least one `sources[]` entry has `source_year >= config.year` AND `type === 'official'`. | `not-verified-this-year` (L0/L7) |
| 2 | `age_eligible` | `config.age` is within `[eligibility.min_age, eligibility.max_age]` (treating null endpoints as open). | `age-mismatch` (L1) |
| 3 | `grade_eligible` | `config.rising_grade >= eligibility.min_grade_rising` AND `config.rising_grade <= eligibility.max_grade_rising`. | `grade-mismatch` (L1) |
| 4 | `dates_eligible` | `any_session_fits === true`. | `no-session-fits-windows` (L2) |
| 5 | `geo_eligible` | `nearest_anchor.drive_hours <= config.max_drive_hours` (or within +0.5hr borderline, in which case set `borderline: true` and pass). | `out-of-drive-radius` (L3) |
| 6 | `format_eligible` | `config.format === 'any'` OR program's format prefix matches (`residential-*` matches `residential`). | `format-mismatch` (L5) |
| 7 | `cost_eligible` | `config.cost_cap_usd === null` OR `cost.all_in_usd <= config.cost_cap_usd` (with `cost_complete: false` → pass with `cost_borderline: true`). | `over-cost-cap` (L6) |
| 8 | `deadline_eligible` | `application.status !== 'closed'`. **Closed programs that look otherwise perfect** go to a separate appendix, not the rejected list — they're sometimes wait-list reachable (L4). | `deadline-passed` (L4) |

**Mark, never delete.** Set `status = 'rejected'` and `rejection_reason = '<code>'`. The appendix in the final report groups rejected programs by reason — that's the audit trail the user uses to sanity-check the filter logic.

A program that passes all 8 stays `status = 'candidate'`.

---

## Step 6 — Score survivors

Each surviving program is scored 0–5 per bucket. **Scores are judgment calls grounded in evidence**, not algorithms. Use the rubric for defensibility.

| Bucket | Rubric |
|---|---|
| `prestige` | 5 = top-tier (Cherubs/RSI/MITES tier or flagship of host institution); 4 = strong host-program reputation, named in 3+ aggregators; 3 = solid official program; 2 = small/regional; 1 = thin signal. |
| `fit_to_interests` | 5 = topic_tags ∩ `config.interests` ≥ 2 strong matches; 4 = 1 strong + adjacent; 3 = adjacent only; 2 = tangential; 1 = mismatch. (For an empty `config.interests`, default to 3.) |
| `daughter_fit` | Read the person's ghostwheel profile. 5 = host city + program vibe align strongly (Ashi: urban + walkable + aesthetic → Northwestern Evanston / UChicago / Loyola fit; rural LACs fit less); 3 = neutral; 1 = anti-fit. |
| `dates_clean_fit` | 5 = single session fits an entire window with ≥3 days buffer; 4 = fits with tight buffer; 3 = fits exactly; **0 if no session fits — but this means the row was already rejected, so should never appear at score time**. |
| `social_value` | 5 = residential + strong peer caliber + cohort size 50–200 (sweet spot for friend-making); 4 = residential with smaller/larger cohort; 3 = commuter with strong peer; 2 = commuter, generic peer; 1 = unclear. |
| `independence_balance` | 5 = appropriate-for-age vibe: structured, supervised, not too binge-y, not too kiddy. For rising-10 specifically, programs that bill themselves as "college experience" for rising-11+ can feel adult-oriented; 5 here is the program that lands right at "intentional 14-15yo growth." |
| `cost_value` | 5 = clear value, scholarships available, all-in ≤ $5k; 4 = $5–8k all-in; 3 = $8–12k all-in; 2 = $12–18k all-in; 1 = > $18k all-in with no scholarship pathway. |

**Weights** (judgment-anchored; revise based on the person's profile):

```
fit_to_interests:      2.0
daughter_fit:          1.5
prestige:              1.2
social_value:          1.2
dates_clean_fit:       1.0
independence_balance:  1.0
cost_value:            0.8
```

`composite_score = sum(w_i * s_i) / sum(w_i)`. Mark top **8–12** programs `status = 'finalist'` with `ranking` set (1 = top).

**Don't expose the weights to the user as a knob.** They encode the household-and-person profile; if profile changes, update ghostwheel and re-derive — don't tune weights manually in the search config.

---

## Step 7 — Drill into finalists (the mandatory Pass 2 work)

Skipping this step is the single biggest failure mode of this skill (mirror of `discover-destinations` Step 9). The Pass 1 list is a hypothesis; Pass 2 is where you verify against ground truth, and verification is what makes the report worth handing to the user.

For each of the top 8–12 finalists:

### 7a · Verify against the official page (year-currency, dates, format)

1. **Visit the official page** for `config.year`. Confirm:
   - Dates listed match `sessions[]` after normalization.
   - URL contains the current year OR the page footer / meta has a current-year timestamp.
   - Eligibility statement matches the normalized `eligibility`.
2. If the URL has an old year token (`/summer-2024/`), try the current-year variant. 404 → mark `verified_year_current: false` and re-route to rejected (L7).
3. If the official page is paywalled / login-gated, fall back to a press release or news announcement from the school's news site (`news.<school>.edu`).

### 7b · Verify the application deadline against the portal (L4)

The official program landing page is not the deadline source of truth. The application portal is.

1. Click into "Apply" / "Application." If it loads a portal (Slate, Acceptd, Liaison, GoEnnounce, etc.), the portal date is canonical.
2. If the portal is login-gated, **use Claude in Chrome** and ask the user to log in (or accept that you'll only verify it via a press release). Tag `status_source: 'application-portal'` or `'press-release'` or `'official-page'`; the report shows what level of verification you got.
3. Set `application.status` to `open | rolling | wait-list | closed`. Stamp `status_verified_at` with today's date.
4. **Closed-but-look-perfect** programs (high composite score + closed) go to a "Closed — worth emailing admissions" appendix. Sometimes wait-lists open. Don't make this a finalist row.

### 7c · Verify housing reality (L5)

For residential programs, drill into the housing page. Capture:
- Where students sleep (dorm name? off-campus apartments? hotel? host family?)
- Supervision (RAs on every floor? RA per X students? No overnight supervision?)
- Age separation (under-16 housed separately from 16+?)

Promote the format from `residential` to one of the four specific values (or `residential-uncertain` if the page is genuinely vague).

### 7d · Verify the all-in cost (L6)

Find the fees/tuition page. Sum tuition + room/board + fees. If you can only find tuition, set `cost_complete: false` and explicitly list the unverified components in `cost.what_is_not_included`.

### 7e · Drill into forum reviews for THIS program

Same workflow as `discover-restaurants` Reddit step:

1. Google-search `site:reddit.com "<program full name>"` and variants — full name, common acronym, "Cherubs", "AAP", "PEOPLE", etc.
2. Pull 2–3 threads with ≥10 comments mentioning the program.
3. Extract comment text + score via `browser_evaluate` on `old.reddit.com`.
4. Save as `searches/<id>/raw/reddit-<program-slug>-thread-<N>.json`.
5. Read the threads. Look for:
   - **What students actually do** day to day (hours, intensity, free time, social vibe).
   - **What surprised them** (good or bad).
   - **Sleeper recommendations** ("the actual best part was…").
   - **Warnings** ("don't pick the dorm option" / "the studio teachers were burned out that year").
6. Score-weight reads (L8): score ≥ 10 = strong signal regardless of wording brevity.
7. Save per-program `searches/<id>/<slug>-mentions.json` with the strongest 3–6 mentions:

```json
{
  "program": "Pre-College Architecture",
  "host_institution": "Carnegie Mellon University",
  "sources_drilled": ["official-page", "application-portal", "r/cmu", "r/ApplyingToCollege"],
  "mentions": [
    { "source": "r/cmu", "score": 27, "text": "12-hour studio days; intense but I loved it", "url": "..." },
    { "source": "r/ApplyingToCollege", "score": 15, "text": "Got into CMU EA partly because of the studio portfolio I built here", "url": "..." },
    { "source": "press-release", "text": "2026 program will run June 22 – July 31...", "url": "..." }
  ]
}
```

This file is the single ground truth for Step 8 composition (mirror of `discover-destinations` per-finalist mentions discipline).

---

## Step 8 — Compose write-ups (hand-crafted, mention-driven)

**Composition is a judgment call, not an algorithm.** Restaurants' Step 4c warnings apply verbatim here: no credentials-line prefix, no "r/Sub N mentions" coda, no per-source attribution in prose (the source badges already do that), no padding to a character count.

For each finalist:

1. **Read every source** for the program: official page, application portal, TeenLife/JKCF blurb if any, the saved reddit threads.
2. **Identify what matters for a 14yo (or whatever the person's age) considering this program**:
   - What kind of program is it (academic seminar? studio? lab? performance? leadership?).
   - Who is it actually for (age/grade reality vs marketing; selectivity).
   - What's the day-to-day like (intensity; structure; free time).
   - Why is it on the shortlist (the specific 1–2 things that surfaced it over near-misses).
   - The practical caveat — the one thing the family needs to know to act (deadline status, housing uncertainty, scholarship pathway, etc.).
3. **Write 1–2 short paragraphs.** Voice: **trusted advisor**. Drop the marketing register; describe the thing honestly.
4. **Hard rule (port from restaurants):** every named place or quoted phrase must come from a real source in `<slug>-mentions.json`. If composition wants to add a detail not in mentions, that's a sign the drill-in missed something — go back, re-scrape, or drop the detail. Don't fabricate.

### Worked example (illustrative, not real)

**Raw inputs:**

- Official CMU page: "6-week residential studio modeled on a first-year architecture school experience. Drafting, model-making, site visits, portfolio review."
- Application portal: "Applications closed January 5, 2026."
- r/cmu (27▲): "12-hour studio days; intense but I loved it"
- r/ApplyingToCollege (15▲): "got into CMU EA partly because of the studio portfolio I built here"

**Composed (~80 words):**

> Six-week residential studio that openly models itself on a first-year architecture-school experience — drafting, model-making, site visits, portfolio review with School of Architecture faculty. Reddit alumni describe twelve-hour studio days as the norm and several point to it as a meaningful boost when applying to CMU and similar architecture-school undergrad pipelines. Rising 11–12 only, so Ashi (rising 10) is one year shy of the standard cohort. **2026 applications closed January 5; not an option this summer unless admissions accepts a late wait-list.**

What this does:
- Names the specific format (studio, faculty, portfolio review) from the official page.
- Pulls one specific signal from Reddit ("twelve-hour studio days") that's evidence of the intensity claim.
- Names the precise eligibility-mismatch consequence (one year short of the cohort).
- Closes with the deadline reality, in bold, because that's the actionable thing.
- Does **not** narrate "this fits Ashi's aesthetic side" — that's implicit; the source badges and topic tags carry the fit signal.

### Save composition

The composed `highlights` string gets written back to `programs.json` on the finalist's row:

```js
program.highlights = "<composed paragraph(s)>";
```

The renderer in Step 9 reads it from there.

---

## Step 9 — Render report.md + finalize programs.json

`searches/<id>/report.md` is the V1 deliverable. Structure (use these as `##` headers, in this order):

```markdown
# Summer 2026 — Camps shortlist for Ashi

**Search:** ashi-summer-2026
**Person:** Ashi (age 14, rising 10th)
**Anchors:** PIT, ORD, MSN (≤ 3hr drive)
**Available windows:** 2026-06-01 → 2026-07-10  |  2026-08-01 → 2026-08-31
**Interests:** creative-writing, design, journalism
**Run date:** 2026-05-14

---

## Summary

- Sources mined: <N campus pages, M aggregators, K forum threads>
- Programs considered: <N>
- Hard-filter rejects: <N>  (breakdown: age <a>, grade <b>, dates <c>, geo <d>, format <e>, cost <f>, deadline <g>, year-currency <h>)
- Finalists ranked: <N>
- Open programs:   <N>
- Wait-list / closed-but-worth-emailing: <N>

---

## Finalists (ranked)

### 1. <Program Name> — <Host Institution>

> <one-line tagline from the composition>

| | |
|---|---|
| **Dates** | <date range>  (<duration weeks>) |
| **Format** | <residential-dorm-supervised | commuter | etc.> |
| **Eligibility** | <eligibility human-readable; age/rising-grade range> |
| **All-in cost** | $<n>  (<tuition / room-board / fees breakdown if known>) |
| **Application** | <status, deadline; verified via <source>> |
| **Drive** | <hours> from <anchor>  ·  Host: <host_city> |
| **Source badges** | official ✓ year-current  ·  teenlife ✓  ·  r/<sub> (<n> threads) |
| **Composite score** | <X.X/5.0> |

<composed write-up — 1-2 short paragraphs>

**Sources:**
- <official-page-url> — official 2026 program page
- <reddit-thread-1-url> — r/<sub> (<score>▲)
- <teenlife-or-aggregator-url> — TeenLife profile

**Score breakdown:** fit_to_interests <X>/5 · daughter_fit <X>/5 · prestige <X>/5 · social_value <X>/5 · dates_clean_fit <X>/5 · independence_balance <X>/5 · cost_value <X>/5

<repeat for each finalist 2..N>

---

## Closed — worth emailing admissions

<programs that scored well but their application closed; one-paragraph each + admissions email>

---

## Rejected (audit trail)

Grouped by `rejection_reason`. Each entry: program name + host + one-line reason.

### age-mismatch (N)
- <Program Name> — <Host Institution> — rising 11+ only

### no-session-fits-windows (N)
- <Program Name> — <Host Institution> — runs Jun 22 – Jul 17, spans the work-week conflict

<continue for all rejection reasons>

---

## Notes / followups

- <program> — eligibility ambiguous; recommend emailing admissions about under-16 exceptions
- <program> — housing situation unclear; recommend asking for floor plan + RA ratio
- <program> — cost incomplete; tuition only published, room/board/fees TBD
```

**Hard rules on the report:**

- Every fact in the finalist block must be traceable to `programs.json` for that finalist. The renderer is a templater, not a fabricator.
- The `Source badges` row reflects actual `sources[]` entries; if you don't have a year-current official entry, do not write "year-current ✓" — that's the L0 violation.
- The score breakdown row uses the scores in `programs.scores`, not new numbers — the report is a view, not a re-judgment.

After rendering, write the final `programs.json` (with composition included) and any per-program `<slug>-mentions.json` files. Leave the `raw/` directory intact for audit + future refresh.

---

## Step 10 — Report to user

```
Search ashi-summer-2026 complete.

  Sources mined:           N campus pages, M aggregators, K forum threads
  Programs considered:     <N>
  Hard-filter rejects:     <N> (age <a>, grade <b>, dates <c>, geo <d>, format <e>, cost <f>, deadline <g>, year-currency <h>)
  Finalists ranked:        <N>
  Top 3:                   <Program 1>, <Program 2>, <Program 3>
  Open & actionable:       <N>
  Closed — worth emailing: <N>

  Report:   searches/ashi-summer-2026/report.md
  Data:     searches/ashi-summer-2026/programs.json
  Raw:      searches/ashi-summer-2026/raw/

  Followups:
    - <followup item>
    - <followup item>
```

Open the report in the user's editor of choice (or just print the path). The artifacts at `searches/<id>/` are the share-able shape of V1; if the user wants a webapp render, that's a V2 conversation.

---

## Refresh mode

A subsequent run against an existing `<id>` should:

1. **Re-scrape** the same source set + any new sources added to SOURCES.md since the last run.
2. **Re-run hard filters** (deadline statuses may have changed — programs previously `open` may have closed, and vice versa for waitlists).
3. **Re-score** survivors; the composite ranking may shift as deadlines change.
4. **Mark new programs as `status_change: 'new-since-last-run'`** in the report.
5. **Mark removed programs as `status_change: 'removed-since-last-run'`** — keep them in `programs.json` with `status = 'removed'` so the audit trail survives.
6. **Re-compose only where evidence changed** — if a program's official page or forum threads changed materially, re-compose; otherwise keep the prior `highlights`.

---

## Common failure modes

Each was either a real prior-skill bug or a seed lesson in `LESSONS.md` — when you see one, stop and fix before moving on.

| Symptom | Likely root cause | Fix |
|---|---|---|
| Composed write-up for a program that turned out not to run this year | L0/L7 — no year-current source; treated stale listicle as evidence | Re-apply Step 5 filter 1 (`verified_year_current`); officially-2026 source required |
| Falsely rejected a clearly-eligible program | L1 — eligibility dialect mismatch | Re-check normalizer translations; verify `min_grade_rising` against the page's literal phrase |
| Falsely accepted a program with dates that conflict with work weeks | L2 — used overlap instead of total-fit | `sessionFits` must require `s >= ws AND e <= we` |
| Threw out a program at Lawrence WI because PIT is 5hr away | L3 — geo filter was intersection, not union | `nearest_anchor.drive_hours = min(...)`; pass if any anchor ≤ ceiling |
| Recommended a program whose deadline had passed | L4 — checked marketing page not portal | Pass 2 must verify against application portal; tag `status_source` |
| Daughter signed up for "residential" that's actually unsupervised apartment | L5 — assumed dorm | Pass 2 must drill into housing page; promote to specific format |
| Cost cap let through a program with $4k in hidden fees | L6 — used tuition not all-in | Filter on `all_in_usd`; mark `cost_complete: false` when only tuition known |
| Prestige listicles surfaced 10 programs, all rising-11+ | L9 — prestige bias | For rising 9–10 searches, deprioritize prestige aggregators; lean on per-campus pages and JKCF |
| Report contains a detail no source supports | Composition fabricated | Forbidden. Every claim traces to `<slug>-mentions.json`. Drop the detail or re-scrape. |
| All finalists from one institution | Scoring not differentiating, OR one institution dominates the source set | Check `composite_score` distribution; rebalance by adding more campus sources |
| Forum mentions don't actually mention the program | Universal-threads-list bug (restaurants L18) | Per-program literal-substring scan; drop reddit source if no thread matches |

---

## Related files

- **`LESSONS.md`** (next to this file) — seed lessons; update with `as-confirmed-by` after each run.
- **`SOURCES.md`** (next to this file) — curated per-anchor campus + aggregator + forum list. Edit before each run if new anchors or new sources need adding.
- **`../discover-restaurants/SKILL.md`** — shared scrape discipline; the source of truth for the Playwright-MCP + Reddit + normalize patterns this skill builds on.
- **`../discover-destinations/SKILL.md`** — shared two-pass discipline, drill-in-finalist composition discipline. The destinations skill is the closest structural sibling.
- **`tools/_load-travel-context.mjs`** — ghostwheel reader (canonical preferences source). Works for any person slug.
- **`tools/create-camp-search.mjs`** — scaffolds `searches/<id>/config.json` + `raw/` directory.
- **`searches/<id>/_normalize.mjs`** — per-search normalizer; new file per search, encapsulates the eligibility/dates/cost translators and the cross-source merge table.
