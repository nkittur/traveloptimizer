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

## Tools
- **collect-options**: Interactive conversational tool. Gathers trip constraints/preferences, researches destinations, suggests scored options. Usage: `./tools/collect-options [trip-id]`

## Design Principles
- Tools are conversational where gathering input, single-shot where transforming data
- Family profile is persistent — learn and remember preferences across trips
- Trip JSON is the source of truth — all tools read before modifying, merge don't overwrite
- Be opinionated — recommend best options, not just neutral lists
- Use web research when it adds value (deals, seasonal info, visa requirements)

## Patterns Learned
_Will be populated as we discover what works_
