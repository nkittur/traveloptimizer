# Pittsburgh end-to-end run — audit findings

Running the discover-restaurants skill on Pittsburgh as a full end-to-end test. This file is the running audit log: what went right, what went wrong, where the skill was unclear, what the coverage looked like at each stage, and whether the pipeline order actually held.

---

## Run metadata

- **Start:** 2026-04-11
- **City:** Pittsburgh, USA
- **Group id:** `wp2j8ihe`
- **Criteria:** "Best foodie restaurants — no chains, not on the list for being cheap or for service alone, pure food quality"
- **Created by:** Niki
- **Public:** yes

---

## Resume instructions

Group `wp2j8ihe` exists in Supabase (empty, no restaurants yet). To resume:

```
/discover-restaurants wp2j8ihe
```

This will load the existing group and continue from Step 2 (source picking). The user's criteria: best foodie restaurants, no chains, not cheap-eats or service-focused, pure food quality.

**Sources planned (Step 2):**
- Eater Pittsburgh (`pittsburgh.eater.com/maps/best-restaurants-pittsburgh`)
- The Infatuation (check if Pittsburgh page exists)
- Condé Nast Traveler (`cntraveler.com/gallery/best-restaurants-in-pittsburgh`)
- Pittsburgh Post-Gazette / local food critics (Google search)
- Reddit `r/pittsburgh` (mandatory — search for food threads)
- Michelin — skip (no Pittsburgh coverage)
- 50 Best — skip (no Pittsburgh entries)

**Stopped at:** Step 3 (scraping), before any source was scraped. Playwright MCP browser died. No data collected yet.

---

## Observations by step

### Step 0 — Pre-flight
- Skill loaded, LESSONS.md read (L1-L18 reviewed)
- Preconditions: Supabase reachable (group created successfully), Playwright MCP needs restart, GOOGLE_MAPS_API_KEY assumed in .env from prior runs

### Step 1 — Load or create group
- ✅ Created group `wp2j8ihe` via `tools/create-group.mjs` — correct tool, correct flags
- ✅ Public flag set, criteria captured

### Step 2 — Pick sources
- Planned 5 sources (3 editorial + Reddit + local newspaper) — meets the ≥3 editorial floor
- Pittsburgh has no Michelin guide or 50 Best entries — correctly skipped
- Observation: should also check for Pittsburgh Magazine or Pittsburgh City Paper as local sources

### Step 3 — Scrape

### Step 4a — Normalize (pass 1)

### Step 5 — Upsert (pass 1)

### Step 6 — Enrichment

### Step 4b/c — Dump + hand-craft descriptions (pass 2)

### Step 5 (pass 2) — Re-upsert with descriptions

### Step 7 — Report

---

## Coverage summary

(Filled at end of run.)

---

## Issues worth adding to LESSONS.md

(Any new root cause that the skill's current L1-L18 didn't already prevent.)
