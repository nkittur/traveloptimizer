#!/usr/bin/env node
// upsert-group-restaurants.mjs
// Writes a discovery run for a group: creates a discovery_runs row,
// upserts incoming restaurants, marks missing ones as 'removed'.
//
// Usage:
//   node tools/upsert-group-restaurants.mjs <group-id> < normalized.json
//
// Stdin: JSON array of restaurant objects (canonical schema — see SKILL.md).
import { pg, selectOne, selectMany, upsert, update, insert, slugify } from './_db.mjs';

const groupId = process.argv[2];
if (!groupId) {
  console.error('Usage: upsert-group-restaurants.mjs <group-id> < restaurants.json');
  process.exit(1);
}

// Verify the group exists
const group = await selectOne('groups', { id: groupId });
if (!group) {
  console.error(`No group with id=${groupId}`);
  process.exit(2);
}

// Read incoming JSON from stdin
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const rawInput = Buffer.concat(chunks).toString('utf-8').trim();
if (!rawInput) {
  console.error('No stdin input — pipe a JSON array of restaurants.');
  process.exit(3);
}
let incoming;
try {
  incoming = JSON.parse(rawInput);
} catch (e) {
  console.error('Invalid JSON on stdin:', e.message);
  process.exit(4);
}
if (!Array.isArray(incoming)) {
  console.error('Stdin must be a JSON array.');
  process.exit(5);
}

// Validate each entry has the minimum required fields
const required = ['name', 'highlights'];
for (const r of incoming) {
  for (const field of required) {
    if (!r[field]) {
      console.error(`Entry missing required field "${field}":`, JSON.stringify(r).slice(0, 200));
      process.exit(6);
    }
  }
  // Ensure id exists (slugify name if not)
  if (!r.id) r.id = slugify(r.name);
  // Ensure sources is at least []
  if (!Array.isArray(r.sources)) r.sources = [];
  // Ensure inTargetArea defaults to true
  if (r.inTargetArea == null) r.inTargetArea = true;
}

console.log(`Group: ${group.name} (${group.city_name})`);
console.log(`Incoming: ${incoming.length} restaurants`);

// 1. Create the discovery_runs row (run id = short token with timestamp)
const runId = `run-${Date.now().toString(36)}`;
await insert('discovery_runs', {
  id: runId,
  group_id: groupId,
  started_at: new Date().toISOString(),
});
console.log(`Run id: ${runId}`);

// 2. Load existing active rows for this group
const existing = await selectMany('group_restaurants', { group_id: groupId }, 'select=restaurant_id,data,status,first_seen_run');
const existingById = new Map(existing.map(r => [r.restaurant_id, r]));

// 3. Build upsert rows — merge sources if an existing row matches
const incomingIds = new Set();
const upsertRows = [];
let added = 0;
let stillPresent = 0;

for (const r of incoming) {
  incomingIds.add(r.id);
  const prev = existingById.get(r.id);

  if (prev) {
    // Preserve enrichment fields from prev (lat/lng, googleRating, price, photos, hours)
    // but take everything else — including the sources array — from the incoming run.
    // Each discovery run is a complete snapshot; source drift across runs should reset,
    // not accumulate stale entries with slightly different detail strings.
    const prevData = prev.data || {};
    const ENRICHMENT_FIELDS = ['lat', 'lng', 'googleRating', 'googleReviewCount', 'googleReviews', 'openingHours', 'photos', 'photoUrl', 'price'];
    const preserved = {};
    for (const k of ENRICHMENT_FIELDS) {
      if (prevData[k] != null) preserved[k] = prevData[k];
    }
    upsertRows.push({
      group_id: groupId,
      restaurant_id: r.id,
      data: { ...r, ...preserved },
      first_seen_run: prev.first_seen_run || runId,
      last_seen_run: runId,
      status: 'active',
    });
    stillPresent++;
  } else {
    upsertRows.push({
      group_id: groupId,
      restaurant_id: r.id,
      data: r,
      first_seen_run: runId,
      last_seen_run: runId,
      status: 'active',
    });
    added++;
  }
}

// 4. Find rows that existed but are NOT in the incoming set
const removedIds = [];
for (const prev of existing) {
  if (!incomingIds.has(prev.restaurant_id) && prev.status === 'active') {
    removedIds.push(prev.restaurant_id);
  }
}

// 5. Upsert in batches
const BATCH = 50;
for (let i = 0; i < upsertRows.length; i += BATCH) {
  const slice = upsertRows.slice(i, i + BATCH);
  await upsert('group_restaurants', slice, { onConflict: 'group_id,restaurant_id' });
  process.stderr.write(`  upserted ${Math.min(i + BATCH, upsertRows.length)}/${upsertRows.length}\r`);
}
process.stderr.write('\n');

// 6. Mark removed rows
for (const rid of removedIds) {
  await update('group_restaurants',
    { group_id: groupId, restaurant_id: rid },
    { status: 'removed', last_seen_run: runId });
}

// 7. Finalize discovery_runs row
await update('discovery_runs', { id: runId }, {
  completed_at: new Date().toISOString(),
  places_added: added,
  places_removed: removedIds.length,
  places_still_present: stillPresent,
  summary: {
    incoming_count: incoming.length,
    sources: [...new Set(incoming.flatMap(r => r.sources.map(s => s.type)))],
    removed_ids: removedIds,
  },
});

// 8. Report
console.log(`\n✓ Run ${runId} complete`);
console.log(`  Added:         ${added}`);
console.log(`  Still present: ${stillPresent}`);
console.log(`  Removed:       ${removedIds.length}${removedIds.length ? ' (' + removedIds.join(', ') + ')' : ''}`);
console.log(`\nNext: enrich with geocoding, Google Places details, and photos:`);
console.log(`  node tools/enrich-group-geocode.mjs ${groupId}`);
console.log(`  node tools/enrich-group-details.mjs ${groupId}`);
console.log(`  node tools/enrich-group-photos.mjs ${groupId}`);
console.log(`\nShare link: https://webapp-rust-phi.vercel.app/?g=${groupId}`);
