#!/usr/bin/env node
// Re-apply scraped flight data after the "no 2-stop" rule was added (2026-04-27).
// Per-destination 1-stop-only data scraped 2026-04-27. For destinations where
// no 1-stop exists from PIT, switch to a viable alternate airport + ground note.

import { selectMany, pg } from './_db.mjs';

const TRIP = 'cg7pgj64';

const UPDATES = {
  'slovenia-bled-ljubljana': {
    flight_estimate: { total_hours_door_to_door: 12.42, round_trip_pp_usd: 1473, stops: '1 stop',
      sampled_window: '2026-08-08 → 2026-08-15 (1-stop only)', quality: 'good',
      note: 'Single 1-stop option in window — typical via FRA/MUC/VIE.',
      source: 'google-flights-rescrape-2026-04-27' },
  },
  'asturias-spain': {
    airport_codes: ['BIO', 'OVD'],
    flight_estimate: { total_hours_door_to_door: 10.42, round_trip_pp_usd: 1865, stops: '1 stop',
      sampled_window: '2026-08-08 → 2026-08-15 (1-stop via BIO)', quality: 'good',
      note: 'Re-routed via BIO (Bilbao) + ~2h drive west to Asturias coast — OVD has no 1-stop from PIT.',
      source: 'google-flights-rescrape-2026-04-27' },
  },
  'vancouver-tofino': {
    flight_estimate: { total_hours_door_to_door: 7.12, round_trip_pp_usd: 1021, stops: '1 stop',
      sampled_window: '2026-08-08 → 2026-08-15 (1-stop only)', quality: 'good',
      note: 'Cheaper 1-stop option exists at $712/9h if willing to add 2h transit; we picked the shorter routing.',
      source: 'google-flights-rescrape-2026-04-27' },
  },
  'bergen-fjords-norway': {
    airport_codes: ['OSL', 'BGO'],
    flight_estimate: { total_hours_door_to_door: 12.78, round_trip_pp_usd: 1702, stops: '1 stop',
      sampled_window: '2026-08-08 → 2026-08-15 (1-stop via OSL)', quality: 'good',
      note: 'Re-routed via OSL (Oslo) — direct PIT→BGO needs 2+ stops. Add 50min Norwegian Air domestic to BGO once at Oslo.',
      source: 'google-flights-rescrape-2026-04-27' },
  },
  'magdalen-islands-quebec': {
    flight_estimate: { total_hours_door_to_door: null, round_trip_pp_usd: null, stops: '2+ stops required',
      sampled_window: '2026-08-08 → 2026-08-15 (no 1-stop available)', quality: 'unviable',
      note: 'PIT→YGR has no 1-stop option in early August. The Magdalen Islands genuinely require 2-3 stops to reach. Per the family no-2-stop rule, this destination is not viable from PIT this trip.',
      source: 'google-flights-rescrape-2026-04-27' },
  },
};

const dests = await selectMany('trip_destinations', { trip_id: TRIP },
  'select=id,slug,operational&status=eq.finalist');
const bySlug = Object.fromEntries(dests.map(d => [d.slug, d]));

for (const [slug, patch] of Object.entries(UPDATES)) {
  const d = bySlug[slug];
  if (!d) { console.error(`! ${slug} not found`); continue; }
  const newOp = { ...(d.operational || {}), ...patch };
  await pg(`/trip_destinations?id=eq.${d.id}`, {
    method: 'PATCH', body: JSON.stringify({ operational: newOp }),
  });
  const fe = patch.flight_estimate;
  console.log(`  ✓ ${slug.padEnd(28)} ${fe.round_trip_pp_usd ? '$' + fe.round_trip_pp_usd : '(unviable)'} / ${fe.total_hours_door_to_door || '—'}h / ${fe.stops}`);
}
console.log('\nDone.');
