# AI Travel Planner - TravelOptimizer

## Purpose
An AI travel planner for a family (user, wife, daughter). Built as a collection of smart CLI tools that call Claude recursively to embody different planning skills. Focus: fly somewhere, then plan optimized itineraries.

## Architecture
- **CLI-first**: Each skill is a bash script in `tools/`
- **Recursive Claude calls**: Tools launch `claude` (interactive) or `claude -p` (single-shot) with system prompts and context
- **Shared state**: `profile/family.json` holds persistent family info; `trips/<trip-id>.json` holds per-trip data — all tools read/write these
- **Web-enabled**: Tools use web search/fetch when they need real-time info (flights, events, visa, weather)
- **Composable**: Tools can call each other, forming pipelines

## Key Files
```
profile/family.json    # Persistent family preferences, constraints, members
trips/<trip-id>.json   # Per-trip data (constraints, preferences, options, itinerary)
tools/                 # CLI tools — each is a specialist agent
patterns/              # Codified patterns and templates
examples/              # Example usage and trip plans
```

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
_Will be populated as we discover what works_
