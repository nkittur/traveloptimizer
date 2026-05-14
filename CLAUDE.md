# AI Travel Planner - TravelOptimizer

## Purpose
An AI travel planner for a family (user, wife, daughter). Built as a collection of smart CLI tools that call Claude recursively to embody different planning skills. Focus: fly somewhere, then plan optimized itineraries.

## Architecture
- **CLI-first**: Each skill is a bash script in `tools/`
- **Recursive Claude calls**: Tools launch `claude` (interactive) or `claude -p` (single-shot) with system prompts and context
- **Shared state**: family preferences live in **ghostwheel** (`../ghostwheel/data/people/*.md` + `../ghostwheel/data/preferences/{travel,food}.md`) — load via `tools/_load-travel-context.mjs`. Per-trip state lives in `trips/<trip-id>.json` and (for trips run through the destinations skill) in Supabase tables.
- **Web-enabled**: Tools use web search/fetch when they need real-time info (flights, events, visa, weather)
- **Composable**: Tools can call each other, forming pipelines

## Key Files
```
../ghostwheel/data/people/{niki,carissa,ashi,robbie,jess}.md
                       # Per-person profiles (canonical) — name, role, age, travel + food sections
../ghostwheel/data/preferences/travel.md
                       # Family-level travel preferences (climate, vibes, flights, driving, recently_visited, city contacts)
../ghostwheel/data/preferences/food.md
                       # Family-level food preferences
trips/<trip-id>.json   # Per-trip data (constraints, preferences, options, itinerary)
tools/_load-travel-context.mjs
                       # Helper: reads ghostwheel and returns structured context for tools
tools/                 # CLI tools — each is a specialist agent
patterns/              # Codified patterns and templates
examples/              # Example usage and trip plans
```

**Single source of truth for family preferences is ghostwheel.** Do not introduce parallel preference stores in this repo. If you need richer per-person data (e.g., a new person), add it to ghostwheel and re-export via `_load-travel-context.mjs`.

## Restaurants webapp (the main active project)

A multi-tenant mobile webapp where "groups" own a curated list of best-of restaurants for a city. Deployed at https://webapp-rust-phi.vercel.app/. Backed by Supabase. Groups are addressable by an 8-char unguessable token; flagging `is_public=true` makes a group discoverable from the home picker.

**Group lifecycle (important):** groups are created **exclusively via `tools/create-group.mjs` or the `discover-restaurants` skill** (which calls that tool under the hood). The webapp picker is read-only — it never creates groups. The reason is that a useful group requires the discovery + enrichment pipeline (Playwright MCP scrapes, Google Places enrichment, Supabase writes), none of which can run in a static SPA. Creating from the webapp would produce empty shells.

Typical flow:
1. User asks me (Claude) to "discover restaurants for <city>" or similar
2. Discovery skill creates the group row via `tools/create-group.mjs` (or reuses an existing id)
3. Skill scrapes ≥3 credible sources with Playwright MCP, normalizes via `tools/_normalize-*.mjs` helpers, upserts with `tools/upsert-group-restaurants.mjs`
4. Enrichment pipeline (`tools/enrich-group-all.mjs`) fills in lat/lng, Google Places ratings, opening hours, photos, and computes `target_area`
5. User visits `https://webapp-rust-phi.vercel.app/?g=<token>` (or the public picker at `/`) and uses the list

**Scrape/enrich boundary:** the scrape owns `name`, `highlights`, `insiderTip`, `cuisine` (when source names it), `sources`. Everything operational (address, hours, price, lat/lng, photos, ratings) comes from Google Places via the enrichment pipeline. Don't drill into per-restaurant detail pages on source sites for operational data — Google Places has it and is fresher.

## Tools
- **tools/create-group.mjs** — create a new group row (the only supported way). See `--help`.
- **tools/get-group.mjs** — print a group row as JSON
- **tools/upsert-group-restaurants.mjs** — upsert the normalized JSON for a discovery run (stdin-driven)
- **tools/enrich-group-all.mjs** — full deterministic enrichment pipeline: geocode → details → photos → target area
- **tools/enrich-group-{geocode,details,photos}.mjs** — individual enrichment steps
- **tools/compute-target-area.mjs** — derive bbox/center/zoom from geocoded points
- **tools/_db.mjs** — shared Supabase REST helper (reads URL + anon key from `webapp/index.html`)
- **collect-options** — older interactive CLI for trip constraint gathering (pre-webapp era)

## Design Principles
- **Scrape for editorial, enrich for operational.** Never mix the two layers.
- Groups are created only through CLI tools, never the webapp. Picker is read-only.
- Tools are conversational where gathering input, single-shot where transforming data
- Trip JSON / Supabase tables are the source of truth — all tools read before modifying, merge don't overwrite
- Be opinionated — recommend best options, not just neutral lists
- Use Playwright MCP (not WebFetch) for any JavaScript-rendered site

## Patterns Learned

The `discover-destinations` skill build (Aug 2026 trip) produced a substantial body of architecture decisions and lessons learned. See:

- `.claude/skills/discover-destinations/ARCHITECTURE.md` — three-layer pipeline (scrape / enrich / compose), data model, invariants, UX patterns
- `.claude/skills/discover-destinations/LESSONS.md` — indexed log of mistakes + fixes by topic (data acquisition, filtering, scoring, composition, photos, loyalty, family preferences, UX, operational data, architecture, process)
- `../ghostwheel/data/preferences/travel.md` — canonical family preferences (climate, flights, recently-visited cooldown, hotel cap, loyalty cards)

The cardinal rule: **every place name surfaced on a trip page must trace back to a real source** — scraped articles (verified) or training-knowledge (clearly labeled `sources: ['curated']`). Mixing the two without honest labeling makes the system untrustworthy.
