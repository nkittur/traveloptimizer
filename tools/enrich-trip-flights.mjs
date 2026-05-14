#!/usr/bin/env node
// enrich-trip-flights.mjs — annotate each active destination with PIT-routing
// info. Operates as a fast bulk pass against a curated PIT nonstops list
// (`tools/_pit-nonstops.json`). For finalists, the discover-destinations skill
// should follow up with a per-destination Google Flights scrape (via Playwright
// MCP or `tools/scrape-flights.mjs`) for actual prices.
//
// Reads each destination's `operational.airport_codes` (array). If unset, the
// destination gets `pit_routing.status='unknown'` and a hint in the log.
//
// Usage:
//   node tools/enrich-trip-flights.mjs <trip-id>
//   node tools/enrich-trip-flights.mjs <trip-id> --force   # rewrite even if already enriched

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { selectOne, selectMany, pg } from './_db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const tripId = process.argv[2];
const force = process.argv.includes('--force');
if (!tripId) {
  console.error('Usage: enrich-trip-flights.mjs <trip-id> [--force]');
  process.exit(1);
}

const trip = await selectOne('trips', { id: tripId });
if (!trip) { console.error(`No trip ${tripId}`); process.exit(2); }
if (trip.origin_airport && trip.origin_airport !== 'PIT') {
  console.error(`Note: trip origin is ${trip.origin_airport}, this tool encodes PIT only.`);
}

const data = JSON.parse(readFileSync(resolve(__dirname, '_pit-nonstops.json'), 'utf-8'));
const yearRound = new Set([...data.domestic_year_round, ...data.international_year_round]);
const summerSeasonal = new Set([...data.domestic_seasonal_summer, ...data.international_seasonal_summer]);

const dests = await selectMany('trip_destinations', { trip_id: tripId },
  'select=id,slug,name,country,operational&status=in.(candidate,active,finalist)');

console.log(`Trip: ${trip.name}`);
console.log(`Destinations to enrich: ${dests.length}`);
console.log(`Reference list as of: ${data.as_of}`);

let updated = 0, skipped = 0, unknown = 0;

for (const d of dests) {
  if (!force && d.operational?.pit_routing?.checked_at) { skipped++; continue; }

  const codes = d.operational?.airport_codes || [];
  let routing;
  if (!codes.length) {
    routing = {
      status: 'unknown',
      reason: 'no airport_codes set on destination',
      checked_at: new Date().toISOString(),
      source: 'pit-nonstops.json',
    };
    unknown++;
  } else {
    const matches = codes.filter(c => yearRound.has(c) || summerSeasonal.has(c));
    if (matches.length === 0) {
      routing = {
        status: 'no_nonstop',
        airport_codes: codes,
        connecting_required: true,
        checked_at: new Date().toISOString(),
        source: 'pit-nonstops.json',
        as_of: data.as_of,
        note: 'Verify connecting options for finalists via Google Flights.',
      };
    } else {
      const seasonal = matches.some(c => summerSeasonal.has(c));
      routing = {
        status: 'nonstop',
        airport_codes: codes,
        nonstop_airports: matches,
        seasonal: seasonal,
        checked_at: new Date().toISOString(),
        source: 'pit-nonstops.json',
        as_of: data.as_of,
        carriers: matches.map(c => data.by_airport_metadata[c]?.carrier).filter(Boolean),
      };
    }
  }

  const newOperational = { ...(d.operational || {}), pit_routing: routing };
  await pg(`/trip_destinations?id=eq.${d.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ operational: newOperational }),
  });
  updated++;
  process.stderr.write(`  ${d.slug}: ${routing.status}${routing.nonstop_airports ? ' ('+routing.nonstop_airports.join(',')+')' : ''}\n`);
}

console.log(`\n✓ Enrichment complete`);
console.log(`  Updated: ${updated}`);
console.log(`  Skipped (already enriched): ${skipped}`);
console.log(`  Unknown (missing airport_codes): ${unknown}`);
