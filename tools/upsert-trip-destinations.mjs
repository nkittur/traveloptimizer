#!/usr/bin/env node
// upsert-trip-destinations.mjs
// Snapshot upsert for a trip's candidate destinations. Mirrors the contract of
// upsert-group-restaurants.mjs:
//   - new entries inserted as 'candidate' (or whatever status the input gives)
//   - existing slugs replaced (status, scores, sources, composition fields take
//     incoming values; user-set fields preserved if the input omits them)
//   - existing slugs NOT in the incoming set → status='removed'
//
// Usage:
//   node tools/upsert-trip-destinations.mjs <trip-id> < destinations.json
//
// Stdin JSON shape — array of:
//   {
//     slug, name, country, region, lat, lng,
//     status, rejection_reason, ranking, composite_score,
//     scores, operational, sources,
//     report_md, itinerary, hotel_pick
//   }
import { pg, selectOne, selectMany, upsert, update, slugify } from './_db.mjs';

const tripId = process.argv[2];
if (!tripId) {
  console.error('Usage: upsert-trip-destinations.mjs <trip-id> < destinations.json');
  process.exit(1);
}

const trip = await selectOne('trips', { id: tripId });
if (!trip) {
  console.error(`No trip with id=${tripId}`);
  process.exit(2);
}

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const raw = Buffer.concat(chunks).toString('utf-8').trim();
if (!raw) {
  console.error('No stdin input — pipe a JSON array of destinations.');
  process.exit(3);
}

let incoming;
try { incoming = JSON.parse(raw); } catch (e) {
  console.error('Invalid JSON on stdin:', e.message);
  process.exit(4);
}
if (!Array.isArray(incoming)) {
  console.error('Stdin must be a JSON array.');
  process.exit(5);
}

// Normalize entries
for (const d of incoming) {
  if (!d.name) {
    console.error('Entry missing name:', JSON.stringify(d).slice(0, 200));
    process.exit(6);
  }
  if (!d.slug) d.slug = slugify(d.country ? `${d.name}-${d.country}` : d.name);
  if (!d.status) d.status = 'candidate';
  if (!Array.isArray(d.sources)) d.sources = [];
  if (!d.scores) d.scores = {};
  if (!d.operational) d.operational = {};
}

console.log(`Trip: ${trip.name} (id=${tripId})`);
console.log(`Incoming: ${incoming.length} destinations`);

// Load existing
const existing = await selectMany('trip_destinations', { trip_id: tripId });
const existingBySlug = new Map(existing.map(d => [d.slug, d]));

const incomingSlugs = new Set();
let added = 0, updated = 0;

for (const d of incoming) {
  incomingSlugs.add(d.slug);
  const prev = existingBySlug.get(d.slug);

  // Build the row payload. For an existing destination, fields the caller
  // omits (== null) are preserved from the previous row — useful when an
  // enrichment step writes only operational and a composition step writes
  // only report_md/itinerary.
  const row = {
    trip_id: tripId,
    slug: d.slug,
    name: d.name,
    country: d.country ?? prev?.country ?? null,
    region:  d.region  ?? prev?.region  ?? null,
    lat: d.lat ?? prev?.lat ?? null,
    lng: d.lng ?? prev?.lng ?? null,
    status: d.status,
    rejection_reason: d.rejection_reason ?? prev?.rejection_reason ?? null,
    ranking: d.ranking ?? prev?.ranking ?? null,
    composite_score: d.composite_score ?? prev?.composite_score ?? null,
    scores: { ...(prev?.scores || {}), ...d.scores },
    operational: { ...(prev?.operational || {}), ...d.operational },
    sources: d.sources.length ? d.sources : (prev?.sources || []),
    report_md:  d.report_md  ?? prev?.report_md  ?? null,
    itinerary:  d.itinerary  ?? prev?.itinerary  ?? null,
    hotel_pick: d.hotel_pick ?? prev?.hotel_pick ?? null,
  };

  if (prev) updated++; else added++;

  await upsert('trip_destinations', [row], { onConflict: 'trip_id,slug' });
}

// Anything in existing but not in incoming → mark removed (don't delete; preserves photos for audit)
let removed = 0;
for (const prev of existing) {
  if (!incomingSlugs.has(prev.slug) && prev.status !== 'removed') {
    await update('trip_destinations', { id: prev.id }, { status: 'removed' });
    removed++;
  }
}

console.log(`\n✓ Upsert complete`);
console.log(`  Added:   ${added}`);
console.log(`  Updated: ${updated}`);
console.log(`  Removed: ${removed}`);
console.log(`\nShare link: https://webapp-rust-phi.vercel.app/?t=${tripId}`);
