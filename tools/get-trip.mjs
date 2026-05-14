#!/usr/bin/env node
// get-trip.mjs — Print a trip row (and optionally its destinations + photos) as JSON.
// Usage:
//   node tools/get-trip.mjs <trip-id>            # trip row only
//   node tools/get-trip.mjs <trip-id> --full     # + destinations + photos
import { selectOne, selectMany } from './_db.mjs';

const tripId = process.argv[2];
const full = process.argv.includes('--full');
if (!tripId) {
  console.error('Usage: get-trip.mjs <trip-id> [--full]');
  process.exit(1);
}

const trip = await selectOne('trips', { id: tripId });
if (!trip) {
  console.error(`No trip with id=${tripId}`);
  process.exit(2);
}

if (!full) {
  console.log(JSON.stringify(trip, null, 2));
  process.exit(0);
}

const destinations = await selectMany('trip_destinations', { trip_id: tripId },
  'order=ranking.asc.nullslast,composite_score.desc.nullslast');

const destIds = destinations.map(d => d.id);
const photos = destIds.length
  ? await selectMany('trip_destination_photos', {},
      `trip_destination_id=in.(${destIds.join(',')})&order=trip_destination_id,bucket,rank.asc.nullslast`)
  : [];

const photosByDest = {};
for (const p of photos) {
  (photosByDest[p.trip_destination_id] ||= []).push(p);
}

console.log(JSON.stringify({
  trip,
  destinations: destinations.map(d => ({
    ...d,
    photos: photosByDest[d.id] || [],
  })),
}, null, 2));
