#!/usr/bin/env node
// create-group.mjs — Operator-side CLI: create a new group row in Supabase.
// This is the only supported way to create a group (the webapp picker is
// read-only now). Called directly, or as Step 1 of the discover-restaurants
// skill when populating a fresh city.
//
// Usage:
//   node tools/create-group.mjs \
//     --name "Tokyo Izakaya Hunt" \
//     --city Tokyo \
//     --country Japan \
//     --public \
//     --criteria "izakaya, sushi, ramen; authentic not tourist-facing" \
//     --by Naveen
//
// Prints the new group id to stdout (everything else to stderr) so the id
// can be captured cleanly:
//   ID=$(node tools/create-group.mjs --name X --city Y)
import { pg, slugify } from './_db.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--public') { args.public = true; continue; }
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

if (args.help || !args.name || !args.city) {
  console.error(`Usage: create-group.mjs --name "<group name>" --city "<city>" [--country "<country>"] [--criteria "<free text>"] [--by "<your name>"] [--public]

Prints the new group's 8-char token to stdout.

Required:
  --name      Display name shown in the picker
  --city      City name (used verbatim for Yelp/Maps queries and enrichment fallbacks)

Optional:
  --country   Country name (improves geocoding for international cities)
  --criteria  Free-text criteria the discovery skill can use to bias source picks
  --by        Your name — stamped as created_by_name
  --public    Flag as is_public so it appears in the Discover section`);
  process.exit(args.help ? 0 : 1);
}

const name = String(args.name);
const cityName = String(args.city);
const country = args.country ? String(args.country) : null;
const citySlug = slugify(cityName);
const createdByName = args.by ? String(args.by) : null;
const isPublic = !!args.public;
const criteria = args.criteria ? { freeText: String(args.criteria) } : {};

const rows = await pg('/groups', {
  method: 'POST',
  headers: { 'Prefer': 'return=representation' },
  body: JSON.stringify({
    name,
    city_name: cityName,
    city_slug: citySlug,
    country,
    criteria,
    created_by_name: createdByName,
    is_public: isPublic,
  }),
});

const created = rows?.[0];
if (!created?.id) {
  console.error('Insert succeeded but no row returned. Check Supabase.');
  process.exit(2);
}

// Human-readable summary to stderr
process.stderr.write(`✓ Created group "${created.name}" in ${created.city_name}${country ? ', ' + country : ''}\n`);
process.stderr.write(`  id:        ${created.id}\n`);
process.stderr.write(`  public:    ${created.is_public}\n`);
process.stderr.write(`  criteria:  ${JSON.stringify(criteria)}\n`);
process.stderr.write(`  app URL:   https://webapp-rust-phi.vercel.app/?g=${created.id}\n`);
process.stderr.write(`\nNext: run the discover-restaurants skill against ${created.id} to populate it.\n`);

// The id goes to stdout so it's pipeable
process.stdout.write(created.id + '\n');
