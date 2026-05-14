#!/usr/bin/env node
// [DEPRECATED — use enrich-group-combined.mjs]
// enrich-group-geocode.mjs — Fill lat/lng for active rows in group_restaurants.
// Usage: node tools/enrich-group-geocode.mjs <group-id>
//
// The combined enrichment now gets lat/lng from the single Places Text Search
// (places.location), so a separate Geocoding call is no longer needed.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { selectOne, selectMany, upsert } from './_db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const groupId = process.argv[2];
if (!groupId) { console.error('Usage: enrich-group-geocode.mjs <group-id>'); process.exit(1); }

let API_KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!API_KEY) {
  try {
    const env = readFileSync(resolve(REPO_ROOT, '.env'), 'utf-8');
    const m = env.match(/GOOGLE_MAPS_API_KEY=(.+)/);
    if (m) API_KEY = m[1].trim();
  } catch {}
}
if (!API_KEY) { console.error('No GOOGLE_MAPS_API_KEY in env or .env'); process.exit(1); }

const group = await selectOne('groups', { id: groupId });
if (!group) { console.error(`No group ${groupId}`); process.exit(2); }

const rows = await selectMany('group_restaurants',
  { group_id: groupId, status: 'active' },
  'select=group_id,restaurant_id,data');
console.log(`${group.name}: ${rows.length} active rows`);

async function geocode(query) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${API_KEY}`;
  const res = await fetch(url);
  const j = await res.json();
  return j.results?.[0]?.geometry?.location || null;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const cityCtx = [group.city_name, group.country].filter(Boolean).join(' ');
let geocoded = 0, skipped = 0, failed = 0;
const updates = [];

for (const row of rows) {
  const r = row.data || {};
  if (r.lat != null && r.lng != null) { skipped++; continue; }
  const query = r.address ? `${r.name} ${r.address}` : `${r.name} ${r.neighborhood || ''} ${cityCtx}`.trim();
  const loc = await geocode(query);
  if (loc) {
    r.lat = loc.lat;
    r.lng = loc.lng;
    updates.push({ ...row, data: r });
    geocoded++;
    process.stderr.write(`✓ ${r.name} → ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}\n`);
  } else {
    failed++;
    process.stderr.write(`✗ ${r.name} (${query})\n`);
  }
  await sleep(50);
}

if (updates.length) {
  const BATCH = 50;
  for (let i = 0; i < updates.length; i += BATCH) {
    await upsert('group_restaurants', updates.slice(i, i + BATCH), { onConflict: 'group_id,restaurant_id' });
  }
}
console.log(`\nDone. Geocoded: ${geocoded}, Skipped: ${skipped}, Failed: ${failed}`);
