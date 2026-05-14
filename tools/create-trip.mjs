#!/usr/bin/env node
// create-trip.mjs — Operator-side CLI: create a new trip row in Supabase.
// Sibling of create-group.mjs. The trip is the top-level "where should we go"
// container; destinations are added later by the discover-destinations skill.
//
// Usage:
//   node tools/create-trip.mjs \
//     --name "August 2026 — Family" \
//     --start 2026-08-01 \
//     --end   2026-08-08 \
//     --origin PIT \
//     --travelers niki,carissa,ashi \
//     --criteria "mild climate or beach mitigation; mix of nature + city" \
//     --hard-filter exclude_recently_visited \
//     --by Niki \
//     --public
//
// Prints the new trip's 8-char token to stdout. Everything else to stderr.
import { pg } from './_db.mjs';

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

if (args.help || !args.name) {
  console.error(`Usage: create-trip.mjs --name "<trip name>" [options]

Prints the new trip's 8-char token to stdout.

Required:
  --name        Display name (e.g. "August 2026 — Family")

Optional:
  --start       Trip start date (YYYY-MM-DD)
  --end         Trip end date (YYYY-MM-DD)
  --duration    Days (defaults to end-start+1, or 7 if dates omitted)
  --origin      Origin airport code (defaults to PIT)
  --travelers   Comma-separated ghostwheel slugs (e.g. niki,carissa,ashi)
                Defaults to niki,carissa,ashi.
  --criteria    Free-text trip criteria the discovery skill can use
  --hard-filter Repeatable; known values:
                  exclude_recently_visited   — drop destinations from preferences/travel.md "Recently visited"
                  no_oppressive_heat         — reject hot+humid without beach/water mitigation
                  pit_accessible             — reject if no reasonable PIT routing
  --by          Your name — stamped as created_by_name
  --public      Flag as is_public so the trip appears in the Discover section`);
  process.exit(args.help ? 0 : 1);
}

const name = String(args.name);
const startDate = args.start ? String(args.start) : null;
const endDate   = args.end   ? String(args.end)   : null;
const origin    = args.origin ? String(args.origin) : 'PIT';
const travelerSlugs = args.travelers
  ? String(args.travelers).split(',').map(s => s.trim()).filter(Boolean)
  : ['niki', 'carissa', 'ashi'];
const createdByName = args.by ? String(args.by) : null;
const isPublic = !!args.public;
const criteria = args.criteria ? { freeText: String(args.criteria) } : {};

let durationDays = args.duration ? Number(args.duration) : null;
if (!durationDays && startDate && endDate) {
  const ms = new Date(endDate).getTime() - new Date(startDate).getTime();
  durationDays = Math.round(ms / 86400000) + 1;
}
if (!durationDays) durationDays = 7;

// hard_filter can repeat; --hard-filter foo --hard-filter bar
const hardFilters = {};
const argv = process.argv;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--hard-filter' && argv[i + 1]) hardFilters[argv[i + 1]] = true;
}

const rows = await pg('/trips', {
  method: 'POST',
  headers: { 'Prefer': 'return=representation' },
  body: JSON.stringify({
    name,
    dates_start: startDate,
    dates_end: endDate,
    duration_days: durationDays,
    origin_airport: origin,
    traveler_slugs: travelerSlugs,
    criteria,
    hard_filters: hardFilters,
    created_by_name: createdByName,
    is_public: isPublic,
  }),
});

const created = rows?.[0];
if (!created?.id) {
  console.error('Insert succeeded but no row returned. Check Supabase.');
  process.exit(2);
}

process.stderr.write(`✓ Created trip "${created.name}"\n`);
process.stderr.write(`  id:         ${created.id}\n`);
process.stderr.write(`  dates:      ${startDate || '?'} → ${endDate || '?'}  (${durationDays} days)\n`);
process.stderr.write(`  origin:     ${origin}\n`);
process.stderr.write(`  travelers:  ${travelerSlugs.join(', ')}\n`);
process.stderr.write(`  public:     ${created.is_public}\n`);
process.stderr.write(`  filters:    ${Object.keys(hardFilters).join(', ') || '(none)'}\n`);
process.stderr.write(`  app URL:    https://webapp-rust-phi.vercel.app/?t=${created.id}\n`);
process.stderr.write(`\nNext: run the discover-destinations skill against ${created.id} to populate it.\n`);

process.stdout.write(created.id + '\n');
