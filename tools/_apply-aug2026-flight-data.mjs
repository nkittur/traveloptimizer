#!/usr/bin/env node
// _apply-aug2026-flight-data.mjs
// Writes scraped Google Flights data (one mid-month sample per destination,
// PIT origin, Aug 8-15 round-trip) into operational.flight_estimate. Each
// entry comes from the script-driven Playwright loop; the rule for choosing
// "best" was: the SHORTEST flight whose price ≤ 1.5× cheapest result on the
// page (i.e., reasonably-priced + fast). For destinations Google returned
// suspicious routings (likely missing the year-round nonstop in this date
// window), the entry is marked `quality:'questionable'` so the renderer can
// show a "verify before booking" hint.
//
// Run: node tools/_apply-aug2026-flight-data.mjs

import { selectMany, pg } from './_db.mjs';

const TRIP = 'cg7pgj64';

// scraped: from PIT, Aug 8-15 2026 (Reykjavik used Aug 1-8 — close enough),
// shortest result within 1.5× cheapest price. Hours = total scheduled flight
// time door-to-door (gate-to-gate per Google). For 2-stop Asturias/Bergen
// I noted; for missing Magdalen I used a rough estimate based on adjacent
// Atlantic-Canada connecting routes.
const DATA = {
  'reykjavik-iceland':       { price: 655,  hours: 8.5,   stops: '1 stop',   sampled: '2026-08-01 → 2026-08-08' },
  'cortina-italy':           { price: 1079, hours: 12.27, stops: '1 stop',   sampled: '2026-08-08 → 2026-08-15' },
  'newport-rhode-island':    { price: 338,  hours: 7.33,  stops: '1 stop',   sampled: '2026-08-01 → 2026-08-08', quality: 'questionable',
                               note: 'Cheapest is a long 1-stop. PIT→PVD nonstop usually exists ~1.5h ~$300; verify on Google Flights.' },
  'hamptons-newyork':        { price: 184,  hours: 1.48,  stops: 'Nonstop',  sampled: '2026-08-08 → 2026-08-15',
                               note: 'PIT→JFK ~1.5h. Add ~2h ground (jitney/ferry) to reach the East End.' },
  'slovenia-bled-ljubljana': { price: 1472, hours: 12.0,  stops: '2 stops',  sampled: '2026-08-08 → 2026-08-15' },
  'copenhagen-denmark':      { price: 1053, hours: 9.93,  stops: '1 stop',   sampled: '2026-08-08 → 2026-08-15' },
  'quebec-city-canada':      { price: 609,  hours: 4.35,  stops: '1 stop',   sampled: '2026-08-08 → 2026-08-15' },
  'asturias-spain':          { price: 2243, hours: 13.32, stops: '2 stops',  sampled: '2026-08-08 → 2026-08-15',
                               note: 'OVD is small. BIO (Bilbao, 2h drive) often half the price; consider as alternate airport.' },
  'azores-portugal':         { price: 1511, hours: 9.38,  stops: '1 stop',   sampled: '2026-08-08 → 2026-08-15' },
  'vancouver-tofino':        { price: 474,  hours: 16.87, stops: '2 stops',  sampled: '2026-08-08 → 2026-08-15', quality: 'questionable',
                               note: 'Cheapest is a long 2-stop. A faster 1-stop (~7h) usually exists at ~$600; verify on Google Flights.' },
  'acadia-maine':            { price: 407,  hours: 5.27,  stops: '1 stop',   sampled: '2026-08-08 → 2026-08-15' },
  'stockholm-sweden':        { price: 904,  hours: 14.37, stops: '1 stop',   sampled: '2026-08-08 → 2026-08-15' },
  'marthas-vineyard':        { price: 1144, hours: 3.25,  stops: '1 stop',   sampled: '2026-08-08 → 2026-08-15', quality: 'questionable',
                               note: 'Reported duration looks low; Cape Air final-leg charter often dominates total time/price. Verify on Google Flights.' },
  'costa-brava-spain':       { price: 1312, hours: 10.42, stops: '1 stop',   sampled: '2026-08-08 → 2026-08-15',
                               note: 'PIT→BCN, then ~2h drive north to Costa Brava (Cadaqués / Begur).' },
  'magdalen-islands-quebec': { price: 750,  hours: 8.5,   stops: '2 stops',  sampled: 'estimate (Google returned no results)', quality: 'estimated',
                               note: 'Tiny carrier on the final leg (Air Canada Express → YGR). Real prices vary; verify on Google Flights.' },
  'san-diego-california':    { price: 447,  hours: 6.33,  stops: '1 stop',   sampled: '2026-08-08 → 2026-08-15',
                               note: 'PIT→SAN nonstop on Southwest may be cheaper/faster (~5h ~$400) but didn\'t appear on this date.' },
  'lisbon-portugal':         { price: 510,  hours: 9.48,  stops: '1 stop',   sampled: '2026-08-08 → 2026-08-15' },
  'banff-canada':            { price: 1339, hours: 9.6,   stops: '1 stop',   sampled: '2026-08-08 → 2026-08-15',
                               note: 'PIT→YYC, then ~1.5h drive to Banff townsite.' },
  'montreal-canada':         { price: 594,  hours: 1.4,   stops: 'Nonstop',  sampled: '2026-08-08 → 2026-08-15', quality: 'questionable',
                               note: 'Reported segment time only — full PIT→YUL routing is typically 3–4h with connection.' },
  'halifax-cape-breton':     { price: 674,  hours: 4.67,  stops: '1 stop',   sampled: '2026-08-08 → 2026-08-15' },
  'bergen-fjords-norway':    { price: 1825, hours: 13.98, stops: '2 stops',  sampled: '2026-08-08 → 2026-08-15' },
  'irvine-orange-county':    { price: 333,  hours: 5.08,  stops: 'Nonstop',  sampled: '2026-08-08 → 2026-08-15' },
};

const dests = await selectMany('trip_destinations', { trip_id: TRIP },
  'select=id,slug,operational&status=eq.finalist');

let updated = 0;
for (const d of dests) {
  const e = DATA[d.slug];
  if (!e) { process.stderr.write(`  ! ${d.slug}: no scraped entry\n`); continue; }
  const newOp = {
    ...(d.operational || {}),
    flight_estimate: {
      total_hours_door_to_door: e.hours,
      round_trip_pp_usd:        e.price,
      stops:                    e.stops,
      sampled_window:           e.sampled,
      quality:                  e.quality || 'good',
      note:                     e.note || null,
      source:                   'google-flights-scrape-2026-04-27',
    },
  };
  await pg(`/trip_destinations?id=eq.${d.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ operational: newOp }),
  });
  updated++;
  process.stderr.write(`  ✓ ${d.slug.padEnd(30)} ~${e.hours}h · ~$${e.price} (${e.stops})\n`);
}
console.log(`\n✓ Updated ${updated} of ${dests.length}`);
