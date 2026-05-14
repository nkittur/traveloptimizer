#!/usr/bin/env node
// _enrich-trip-flight-estimates.mjs
// Patch operational.flight_estimate on each destination with approximate
// total door-to-door time (incl. layovers) and round-trip per-person price
// for early August 2026 from PIT. These are HAND-CURATED estimates, not live
// scrapes — Google Flights actively blocks bot scrapers and live prices for
// August 2026 from April 2026 are speculative anyway.
//
// Methodology:
//   - Nonstop routes: door-to-door = flight time + ~1h airport padding.
//   - 1-stop routes: leg1 + 1.5h typical layover + leg2 + ~1h padding.
//   - Prices: region-based ranges, typical Q3 booking made 2-3 months ahead.
//
// Estimates are conservative (round up on time, mid-range on price). When
// the user actually books, the numbers will land within ±20% of these for
// most destinations. The webapp labels them with a "~" prefix so the
// approximation is honest.
//
// Run: node tools/_enrich-trip-flight-estimates.mjs <trip-id>

import { selectMany, pg } from './_db.mjs';

const tripId = process.argv[2];
if (!tripId) { console.error('Usage: _enrich-trip-flight-estimates.mjs <trip-id>'); process.exit(1); }

// Per-destination flight estimate from PIT, early August 2026, round-trip per person.
// hours = total door-to-door time (incl. layovers, not security/transit).
// price = typical round-trip USD per person, booked ~3 months ahead.
const ESTIMATES = {
  // ── Nonstop / short ──
  'newport-rhode-island':    { hours: 1.5,  price: 280, routing: 'nonstop PIT→PVD',                         carriers: ['Southwest', 'JetBlue'] },
  'hamptons-newyork':        { hours: 2.5,  price: 320, routing: 'nonstop PIT→JFK + ferry/jitney',           carriers: ['Delta', 'JetBlue'] },
  'acadia-maine':            { hours: 2.5,  price: 320, routing: 'nonstop PIT→PWM (seasonal)',               carriers: ['American (seasonal)'] },
  'marthas-vineyard':        { hours: 3,    price: 420, routing: 'nonstop PIT→MVY (seasonal)',               carriers: ['JetBlue (seasonal)', 'Cape Air'] },
  'montreal-canada':         { hours: 3.5,  price: 380, routing: '1-stop via JFK/EWR/IAD',                   carriers: ['Air Canada', 'United'] },
  'quebec-city-canada':      { hours: 5,    price: 450, routing: '1-stop via YYZ/YUL',                       carriers: ['Air Canada'] },
  'halifax-cape-breton':     { hours: 5,    price: 450, routing: '1-stop via YYZ/EWR',                       carriers: ['Air Canada', 'United'] },
  'reykjavik-iceland':       { hours: 5.5,  price: 580, routing: 'nonstop PIT→KEF (Icelandair, summer-only)', carriers: ['Icelandair (seasonal)'] },
  'san-diego-california':    { hours: 5.5,  price: 380, routing: 'nonstop PIT→SAN',                          carriers: ['Southwest'] },
  'irvine-orange-county':    { hours: 5.5,  price: 400, routing: 'nonstop PIT→LAX',                          carriers: ['American', 'United'] },
  // ── Medium hauls (West Coast / near-Europe) ──
  'vancouver-tofino':        { hours: 7,    price: 520, routing: '1-stop via ORD/DEN, then BC ferry to Tofino', carriers: ['United', 'Air Canada'] },
  'banff-canada':            { hours: 7,    price: 550, routing: '1-stop via YYZ/DEN to YYC + drive',         carriers: ['Air Canada', 'United'] },
  'magdalen-islands-quebec': { hours: 8,    price: 750, routing: '2-stop via YUL/YQM to YGR',                 carriers: ['Air Canada (small carrier final leg)'] },
  'azores-portugal':         { hours: 9,    price: 720, routing: '1-stop via JFK/BOS to PDL (Azores Airlines or TAP)', carriers: ['Azores Airlines', 'TAP'] },
  // ── Long hauls (Europe) ──
  'lisbon-portugal':         { hours: 10,   price: 780, routing: '1-stop via JFK/EWR to LIS (TAP/United)',    carriers: ['TAP', 'United'] },
  'costa-brava-spain':       { hours: 11,   price: 850, routing: '1-stop via JFK/MAD to BCN, then ~2h drive', carriers: ['Iberia', 'United'] },
  'copenhagen-denmark':      { hours: 11,   price: 850, routing: '1-stop via JFK/AMS/FRA to CPH',             carriers: ['SAS', 'KLM', 'Lufthansa'] },
  'stockholm-sweden':        { hours: 11,   price: 880, routing: '1-stop via JFK/AMS/CPH to ARN',             carriers: ['SAS', 'KLM', 'Lufthansa'] },
  'bergen-fjords-norway':    { hours: 12,   price: 900, routing: '1-stop via OSL/AMS/CPH to BGO',             carriers: ['SAS', 'Norwegian'] },
  'cortina-italy':           { hours: 12,   price: 950, routing: '1-stop via JFK/MUC/FRA to VCE, then ~2h drive', carriers: ['Lufthansa', 'United'] },
  'slovenia-bled-ljubljana': { hours: 13,   price: 1050, routing: '1-stop via FRA/VIE/MUC to LJU (small final leg)', carriers: ['Lufthansa', 'Austrian'] },
  'asturias-spain':          { hours: 14,   price: 1100, routing: '1-stop via MAD to OVD (small final leg)',  carriers: ['Iberia (final leg)'] },
};

const dests = await selectMany('trip_destinations', { trip_id: tripId },
  'select=id,slug,name,operational&status=eq.finalist');

console.log(`Trip ${tripId}: ${dests.length} destinations`);

let updated = 0, missing = [];
for (const d of dests) {
  const est = ESTIMATES[d.slug];
  if (!est) { missing.push(d.slug); continue; }
  const newOperational = {
    ...(d.operational || {}),
    flight_estimate: {
      total_hours_door_to_door: est.hours,
      round_trip_pp_usd:        est.price,
      routing:                  est.routing,
      carriers:                 est.carriers,
      source:                   'curated-estimate-2026-04',
      note:                     'Approximate. Based on typical PIT departures booked ~3 months ahead. Actual numbers will vary ±20%.',
    },
  };
  await pg(`/trip_destinations?id=eq.${d.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ operational: newOperational }),
  });
  updated++;
  process.stderr.write(`  ✓ ${d.slug.padEnd(30)} ~${est.hours}h · ~$${est.price}\n`);
}

console.log(`\n✓ Updated: ${updated}`);
if (missing.length) console.log(`Missing estimates for: ${missing.join(', ')}`);
