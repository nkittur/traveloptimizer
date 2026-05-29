#!/usr/bin/env node
// create-product-search.mjs — Scaffold a new product-search.
// Sibling of create-camp-search.mjs: file-based, not Supabase.
// V1 output for `discover-products` is markdown + JSON on disk; no DB schema.
//
// Writes:
//   searches/<id>/config.json      — the spec skeleton (filled in during Phase 0)
//   searches/<id>/requirements.md  — human-readable requirements template
//   searches/<id>/raw/             — empty dir for per-source raw scrape dumps
//
// The detailed must_haves / nice_to_haves / scoring_weights are NOT passed as
// flags — they are too rich and category-specific. Phase 0 of the skill writes
// them into config.json after the requirements conversation. This tool just
// lays down the skeleton so there's somewhere to write them.
//
// Usage:
//   node tools/create-product-search.mjs \
//     --id basement-dehumidifier-2026 \
//     --category dehumidifier \
//     --use-case "Basement, continuous drain to floor drain, quiet" \
//     --budget-max 400 \
//     --by Niki
//
// Prints the search id to stdout. Human-readable summary to stderr.

import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val == null || val.startsWith('--')) { args[key] = true; }
      else { args[key] = val; i++; }
    }
  }
  return args;
}

const args = parseArgs(process.argv);

if (args.help || !args.id || !args.category) {
  console.error(`Usage: create-product-search.mjs --id "<search-id>" --category "<category>" [options]

Scaffolds searches/<id>/{config.json, requirements.md} + raw/ for a product search.

Required:
  --id          Short slug (e.g. basement-dehumidifier-2026)
  --category    Product category (e.g. dehumidifier, robot-vacuum, espresso-machine)

Optional:
  --use-case    One-line description of the job-to-be-done / context
  --budget-max  Hard USD ceiling (default: none — surface all, flag the expensive ones)
  --budget-target  Comfortable USD target (default: none)
  --by          Your name (stamped into config.json)
  --notes       Free text the skill should respect

The must_haves / nice_to_haves / dealbreakers / scoring_weights are left empty —
Phase 0 of the discover-products skill fills them in after the requirements chat.

Prints the search id to stdout.`);
  process.exit(args.help ? 0 : 1);
}

const id = String(args.id).trim().replace(/[^a-z0-9-]/gi, '-').toLowerCase();
if (!id) { console.error('--id is required and must be a slug'); process.exit(1); }

const category = String(args.category).trim().toLowerCase();
const useCase = args['use-case'] ? String(args['use-case']) : null;
const budgetMax = args['budget-max'] ? Number(args['budget-max']) : null;
const budgetTarget = args['budget-target'] ? Number(args['budget-target']) : null;
const by = args.by ? String(args.by) : null;
const notes = args.notes ? String(args.notes) : null;
const today = new Date();

const searchDir = resolve(REPO_ROOT, 'searches', id);
if (existsSync(searchDir)) {
  console.error(`✗ searches/${id}/ already exists. Delete it first, or pick a new --id.`);
  process.exit(2);
}
mkdirSync(resolve(searchDir, 'raw'), { recursive: true });

const config = {
  id,
  category,
  created_at: today.toISOString(),
  created_by_name: by,
  use_case: useCase,
  notes,
  // Phase 0 fills these:
  context: {},               // category-specific knobs (e.g. {basement_sqft, drain_location, ambient_temp})
  budget_usd: { target: budgetTarget, max: budgetMax },
  must_haves: [],            // hard filters: [{key, label, test}]  — a product failing any → rejected
  dealbreakers: [],          // anti-features: [{key, label, test}] — surfaced in critical reviews → rejected
  nice_to_haves: [],         // scored, not gated: [{key, label}]
  scoring_weights: {},       // {bucket: weight} derived from the user's stated priorities
  // Lifecycle: requirements -> gathering -> scored -> converged
  status: "requirements",
  conviction: { reached: false, notes: null },
};

writeFileSync(resolve(searchDir, 'config.json'), JSON.stringify(config, null, 2) + '\n');

const reqTemplate = `# Requirements — ${id}

**Category:** ${category}
**Use case:** ${useCase || '(fill in)'}
**Budget:** ${budgetTarget ? `target $${budgetTarget}` : 'target TBD'}${budgetMax ? ` / max $${budgetMax}` : ' / no hard cap'}
**Drafted:** ${today.toISOString().slice(0, 10)}${by ? ` by ${by}` : ''}

> Phase 0 deliverable. The user signs off on this before any gathering happens.
> Every must-have here becomes a hard filter; every nice-to-have becomes a scored bucket.

## Context
<!-- The facts that constrain the choice: environment, dimensions, where it sits, how it's used. -->

## Must-haves (hard filters — a product that fails ANY is rejected)
- [ ] ...

## Dealbreakers (anti-features — if critical reviews confirm one, the product is rejected)
- [ ] ...

## Nice-to-haves (scored, not gated)
- [ ] ...

## Priorities (what to optimize, ranked)
1. ...

## Decisions deferred / open questions
- ...
`;

writeFileSync(resolve(searchDir, 'requirements.md'), reqTemplate);

process.stderr.write(`✓ Scaffolded product search "${id}"\n`);
process.stderr.write(`  dir:        searches/${id}/\n`);
process.stderr.write(`  category:   ${category}\n`);
process.stderr.write(`  use case:   ${useCase || '(fill in during Phase 0)'}\n`);
process.stderr.write(`  budget:     ${budgetTarget ? `target $${budgetTarget}` : 'target TBD'}${budgetMax ? ` / max $${budgetMax}` : ' / no hard cap'}\n`);
process.stderr.write(`\nNext: run Phase 0 of discover-products to fill config.json + requirements.md, then gather.\n`);

process.stdout.write(id + '\n');
