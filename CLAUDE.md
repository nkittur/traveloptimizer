# AI Travel Planner - TravelOptimizer

## Purpose
An AI travel planner built as a collection of smart CLI tools that call Claude recursively (e.g., via `claude -p`) to embody different skills. Each tool is a specialist agent that can be composed together to plan, optimize, and manage travel.

## Architecture
- **CLI-first**: Each skill is a standalone CLI tool/script
- **Recursive Claude calls**: Tools invoke `claude -p` to leverage AI reasoning
- **Composable**: Tools can call each other, forming pipelines
- **Iterative development**: We build interactively, codifying what works into repeatable patterns

## Development Approach
- Build tools one at a time, test interactively with the user
- When a pattern works well, codify it as a reusable skill/script
- Keep tools simple and focused on a single responsibility
- Use shell scripts as the primary glue language

## Project Structure
```
tools/          # Individual CLI tools (skills)
patterns/       # Codified patterns and templates
examples/       # Example usage and trip plans
```

## Tools (to be built)
_Will be populated as we build tools interactively_

## Patterns Learned
_Will be populated as we discover what works_
