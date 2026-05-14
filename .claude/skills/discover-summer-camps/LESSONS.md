# Lessons — discover-summer-camps

Same shape as `discover-restaurants/LESSONS.md` and `discover-destinations/LESSONS.md`: a running log of root causes that bit a real run, plus the structural fix that made the bite not repeat.

**Read this before every run.** The cost of the discipline below is a few minutes of upfront skimming; the cost of repeating any one of these in a real run is hours of compose-then-throw-away or, worse, a recommendation that doesn't actually exist.

The first batch (L0–L9) is **seed lessons** — not from a real run yet. They're the dragons I already saw while designing the skill from sibling-skill experience. Treat them as just-as-binding as lessons from real runs; update them with `as-confirmed-by` data after the first run.

---

## L0 — Cardinal rule: every program must trace to a year-current source

**What happened (will happen):** Composing a write-up against a beautiful-looking 2024 listicle. The program looked perfect; the user moved to apply. Turned out the 2024 program ran but the school discontinued it for 2026 — the listicle was just stale.

**Root cause:** Treating any source as evidence-of-existence-this-year. Stale listicles + AI content farms are full of programs that no longer exist.

**Consequence:** Hand-composed write-up for a non-existent program, recommended in a final report, user wasted attention.

**Mitigation in this skill:**
- Every `sources[]` entry has a `source_year` field.
- A program with **no** `source_year >= config.year` source is auto-rejected with reason `not-verified-this-year`.
- The official college page is the year-currency oracle; if it lists this year's dates, that's the proof.
- The mention-aggregation step weights `source_year >= config.year` entries 1.0, prior-year entries 0.25, and undated entries 0.0.

This rule has no exceptions. If a program has 4 stale sources and 0 current ones, it goes in the rejected appendix, not the finalist list.

---

## L1 — Age/grade eligibility is encoded four different ways; standardize on the wire

**What happened (will happen):** A program said "9th–12th grade" on its landing page. Buried in the application FAQ it said "grade rising into the year of attendance." Another program said "ages 14–17" but their application form required completed Algebra II — implicitly rising 11th+.

**Root cause:** Programs encode eligibility in at least four mutually-incompatible ways:
1. **Age range** — "ages 14–17"
2. **Completed grade** — "completed 9th–11th"
3. **Rising grade** — "rising 10th–12th" (i.e. just finished 9th, going into 10th)
4. **Current grade** — "currently in 9th–11th"

A 14yo "rising 10th" matches (1) `ages 14–17`, (2) `completed 9th`, (3) `rising 10th`, and (4) `currently in 9th`. Each program speaks one dialect. Comparing them without translation is wrong.

**Consequence:** The normalizer falsely rejected (or falsely accepted) programs based on a literal-string compare.

**Mitigation in this skill:**
- The canonical eligibility shape is `{ min_age, max_age, min_grade_rising, max_grade_rising }`.
- The normalizer **must translate** every program's eligibility into this shape using the dialect translator below:
  - "completed Nth" → `min_grade_rising = N + 1`
  - "rising Nth" → `min_grade_rising = N`
  - "currently in Nth" → `min_grade_rising = N + 1` (interpreted as "after this school year")
  - "ages N+" → `min_age = N`
- A program is age-eligible if (`config.age >= min_age` OR `min_age == null`) AND (`config.rising_grade >= min_grade_rising` OR `min_grade_rising == null`).
- When the page is genuinely ambiguous, set `eligibility_uncertain: true` and surface "verify by emailing admissions" in the report.

**Specific 14yo-rising-10th watch-list:**
- "Rising 11–12 only" is **extremely common** for academic pre-college programs (Notre Dame Summer Scholars, NHSI/Cherubs, RSI, TASP, SSP, etc.). Don't waste compose time on programs the daughter ages out of.
- "Rising 9–12" is common at: Northwestern CTD, UW-Madison PEOPLE, CMU Pre-College Diversity, Penn State Polymath, Kenyon Young Writers (rising 9–12 sometimes), most arts/conservatory programs.
- Some programs split by track: "Track A: rising 9–10. Track B: rising 11–12." Capture this per-track, not per-program.

---

## L2 — Date-window fit must be calendar-exact and total-fit, not overlap

**What happened (will happen):** A program ran June 22 – July 17. The user's available windows were `Jun 1 – Jul 10` and `Aug 1 – Aug 31`. A naive "overlaps any window" check passed it; it actually fails — the back half (Jul 11–17) lands in the daughter's work weeks.

**Root cause:** Confusing "overlap" with "fit." For a residential program the daughter has to be there the entire run. Any day of the program outside her available windows is disqualifying.

**Consequence:** Falsely surfaced programs the daughter can't actually attend.

**Mitigation in this skill:**
- The fit rule is **total-fit**, not overlap. A program with dates `[s, e]` is eligible iff **there exists a single window** `[ws, we]` in `available_windows` such that `s >= ws AND e <= we`.
- Programs that span multiple windows (e.g., a 2-week program where week 1 is in one window and week 2 in another) **do not fit** even if the unavailable middle is empty for them.
- Multi-session programs (e.g., "Session 1: Jun 15 – Jul 5; Session 2: Jul 13 – Aug 2; Session 3: Aug 5 – Aug 25") are split into one program-row per session, each with its own fit check. The report lists the eligible sessions; ineligible sessions go in the row's `unavailable_sessions[]`.
- "Half-day" / commuter programs running over a longer span are treated the same as residential — fit the entire span.

---

## L3 — Multi-anchor drive radius is union geometry, not intersection

**What happened (will happen):** A program at Lawrence (Appleton, WI) is ~5hr from Pittsburgh, ~3hr from Chicago, ~2hr from Madison. A naive "within 3hr of all anchors" check rejected it. The user actually wants "within 3hr of at least one anchor"; Madison was an option.

**Root cause:** The hard filter for geo is wrongly phrased as "all anchors must be within range." The user's intent is "we have multiple jumping-off points; the daughter can fly/drive to any of them."

**Consequence:** Massively over-pruned candidate set; lost programs the family could actually do.

**Mitigation in this skill:**
- The geo filter is "**any** anchor is within `max_drive_hours`." Compute drive-time-to-each-anchor and keep the **minimum**.
- Per-program record both the closest anchor and its drive time: `nearest_anchor: { code, drive_hours }`. Surface this in the report card so the user knows which jumping-off point applies.
- Programs on the borderline (within +30min of `max_drive_hours`) get `borderline: true` and stay in the candidate set; the report flags them so the user can decide.

**Drive-time source of truth:** SOURCES.md's per-anchor table. Programs at campuses not in SOURCES.md need a manual drive-time lookup — don't guess.

---

## L4 — Deadlines are stamped on landing pages but enforced by the application portal

**What happened (will happen):** A program's marketing page said "applications open!" Three clicks deep, the application portal said the deadline had passed two weeks ago. The marketing page was last updated in February.

**Root cause:** College marketing pages are not the deadline source of truth — the application portal is. Marketing pages are often updated once a year and left to rot.

**Consequence:** Composed an entire write-up for a program whose deadline had already passed.

**Mitigation in this skill:**
- In Pass 2 (finalist drill-in), **always verify the deadline by visiting the actual application portal**, not the marketing page.
- If the application portal is gated by login (common), use Claude in Chrome and ask the user to log in. Cite "verified via application portal on YYYY-MM-DD" in the program's notes.
- Status tags: `open | rolling | wait-list | closed | unknown`. `unknown` is allowed only for programs whose portal is unreachable; the report calls them out.
- For `closed` programs that look otherwise perfect, surface them in a "Closed, but worth emailing admissions" appendix — sometimes wait-list spots open.

---

## L5 — "Residential" doesn't mean what you think it means; check housing

**What happened (will happen):** A program was labeled "residential" but housing was off-campus partner apartments with no supervision overnight. Another was "residential" but only for ages 16+; under-16 had to commute.

**Root cause:** "Residential" is a marketing word, not a regulated term. The reality of the housing situation varies enormously: on-campus dorm with floor RAs vs. off-campus apartment vs. hotel vs. host-family.

**Consequence:** Daughter signed up for what the family thought was a typical dorm experience; turned out to be an unsupervised apartment.

**Mitigation in this skill:**
- The `format` field is one of: `residential-dorm-supervised | residential-dorm-unsupervised | residential-offsite | commuter | hybrid`.
- For any program where the housing description isn't explicit, mark `housing_uncertain: true` and surface "verify with admissions" in the report.
- Be especially skeptical of "residential" for programs admitting under-16 — most have separate younger-student housing rules.

---

## L6 — Cost is rarely just tuition; spell out the full all-in number

**What happened (will happen):** A program quoted "tuition $5,500." Once on the application page, additional fees added up: $1,800 room/board, $400 application + tech fee, $300 supplies fee, $150 health-form processing. Real all-in: $8,150.

**Root cause:** "Tuition" and "program fee" are not interchangeable. Some programs bundle housing into the headline; others don't.

**Consequence:** Cost-cap filter let the program through; family-level affordability conversation happened too late.

**Mitigation in this skill:**
- The `cost_usd` field is the **all-in** number to the best of available evidence. Break out:
  ```json
  "cost": {
    "tuition_usd": 5500,
    "room_board_usd": 1800,
    "fees_usd": 850,
    "all_in_usd": 8150,
    "what_is_included": "...",
    "what_is_not_included": "supplies, transportation to/from campus",
    "scholarships_available": true,
    "source_url": "..."
  }
  ```
- The cost filter and ranker uses `all_in_usd`, not `tuition_usd`.
- If only tuition is published, set `all_in_usd = tuition_usd` but mark `cost_complete: false` and surface "verify housing/fees" in the report.

---

## L7 — Same program at the same college may not run every year

**What happened (will happen):** A program had a beautiful 2024 web page, a Reddit thread of glowing 2024 reviews, and a 2022 alumni newsletter. The skill surfaced it for 2026. The program was discontinued in 2025; the page wasn't taken down.

**Root cause:** Colleges quietly retire programs without updating their public pages. The only way to know is to find a current-year date or a press release.

**Consequence:** Same as L0 — composed a write-up for a non-existent program.

**Mitigation in this skill:**
- L0's `source_year >= config.year` rule catches most of these — but the official-page date is the strongest signal.
- For finalist drill-in, **read the page footer for "last updated" or copyright year**, and check the URL for year-encoded paths (`/summer-2024/`).
- If the URL contains an old year, try the same URL pattern with the current year — if it 404s, the program likely isn't running.

---

## L8 — Reddit upvote == sentiment; high-score bare-name comments are gold

**What happened (will happen):** Same as restaurants L19 — a Reddit comment said "I went to Cherubs" with a score of 40▲ and no other text. The valence heuristic labeled it `mentioned` rather than `top-pick` because it lacked superlative adjectives.

**Root cause:** On Reddit, upvotes are the sentiment signal. A bare-name comment at 40▲ is the strongest possible "this is the program everyone agrees on."

**Consequence:** Program got a lower confidence rating than it should have.

**Mitigation in this skill:**
- Port `computeValence()` from `tools/_normalize-los-angeles.mjs`. Score ≥ 10 → `top-pick` regardless of word choice. Score 3–9 → `mentioned-positive` unless there's an explicit negative ("avoid", "skip", "terrible") in the comment.
- For program threads specifically, watch for the "in-group" tone: r/ApplyingToCollege answers tend to be sparse + insider-coded ("Cherubs" / "MITES" / "RSI" — just the acronym). These are still strong recommendations even when terse.

---

## L9 — "Best of" listicles tend to surface the same five elite programs; balance with local discovery

**What happened (will happen):** US News, Forbes, and three high-school-counselor blogs all named the same top 10: RSI, MITES, TASP, NHSI, Cherubs, Cornell Summer College, Stanford, Yale Young Global Scholars, Carleton Liberal Arts, Brown Pre-College. All require rising 11+. Daughter is rising 10. Net useful programs from these listicles: zero.

**Root cause:** Prestige aggregators select for selectivity, which selects for older age cohorts. They under-cover rising-9-10 programs.

**Consequence:** Hours scraping with no eligible programs to show for it.

**Mitigation in this skill:**
- For under-rising-11 searches, **deprioritize prestige aggregators** in source-picking; lean on per-campus official pages and JKCF Summer Opportunities (which is broader).
- After the first scrape pass, **count eligible-per-source** and surface in the diagnostic. If a source returned 30 programs and 0 are age-eligible, mark it `low-yield-for-age` so future runs know.
- Northwestern CTD, UW-Madison PEOPLE, CMU Pre-College AAP (Architecture Art Programs), Penn State Polymath, Kenyon Young Writers, and the Conservatory-style music camps are the high-yield seams for rising 9–10. Start there.

---

## Open dragons (not yet bitten by; watch for them)

- **Transportation logistics**: a program at Lawrence (Appleton, WI) requires a 4hr drive from Pittsburgh OR a flight to Madison/Milwaukee + 2hr drive. The skill currently surfaces `nearest_anchor` but doesn't compute the realistic travel cost. Consider adding a "transportation note" field to finalists.
- **Multi-week ladders**: some programs offer one-week, two-week, and three-week variants of the same theme. The normalizer should preserve all variants as separate sessions of one program, not merge them.
- **Application essay overhead**: Cherubs, RSI, etc. require multi-week essay submissions. The deadline filter doesn't capture this. Consider an `application_lead_time_weeks` field for finalists.
- **Travel-while-on-campus**: a few residential programs include weekend field trips (e.g., to Chicago for a museum visit). Worth flagging for daughter's urban-aesthetic preference.
- **Photo collection**: V1 skips photos entirely. If the markdown renders to a Notion page or similar later, the program's own gallery URL is worth preserving.
- **Webapp render path**: deferred per V1 scope. If a future run produces a strong report, evaluating webapp render becomes worthwhile — schema would be `camp_searches` + `camp_search_programs` mirroring `trips` + `trip_destinations`.
