#!/usr/bin/env node
// enrich-group-photos.mjs — Fill photos[] (up to 5) via Google Places API.
// Usage: node tools/enrich-group-photos.mjs <group-id>
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { selectOne, selectMany, upsert } from './_db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const MAX_PHOTOS = 5;

const groupId = process.argv[2];
if (!groupId) { console.error('Usage: enrich-group-photos.mjs <group-id>'); process.exit(1); }

let API_KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!API_KEY) {
  try {
    const env = readFileSync(resolve(REPO_ROOT, '.env'), 'utf-8');
    const m = env.match(/GOOGLE_MAPS_API_KEY=(.+)/);
    if (m) API_KEY = m[1].trim();
  } catch {}
}
if (!API_KEY) { console.error('No GOOGLE_MAPS_API_KEY'); process.exit(1); }

const group = await selectOne('groups', { id: groupId });
if (!group) { console.error(`No group ${groupId}`); process.exit(2); }

const rows = await selectMany('group_restaurants',
  { group_id: groupId, status: 'active' },
  'select=group_id,restaurant_id,data');
console.log(`${group.name}: ${rows.length} active rows`);

const cityCtx = [group.city_name, group.country].filter(Boolean).join(' ');

async function searchPhotos(name, address) {
  const query = address ? `${name} ${address}` : `${name} ${cityCtx}`;
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'places.photos',
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 1, languageCode: 'en' }),
  });
  const j = await res.json();
  const photos = j.places?.[0]?.photos;
  if (!photos?.length) return [];
  return photos.slice(0, MAX_PHOTOS).map(p => p.name);
}

function photoUrl(photoName, maxWidth = 400) {
  return `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${maxWidth}&key=${API_KEY}`;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BATCH = 5;
let fetched = 0, skipped = 0, failed = 0;
const updates = [];

for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  await Promise.all(batch.map(async (row) => {
    const r = row.data || {};
    if (r.photos?.length > 1) { skipped++; return; }
    try {
      const names = await searchPhotos(r.name, r.address);
      if (names.length) {
        r.photos = names.map(n => photoUrl(n));
        r.photoUrl = r.photos[0];
        updates.push({ ...row, data: r });
        fetched++;
        process.stderr.write(`✓ ${r.name} (${names.length} photos)\n`);
      } else {
        failed++;
        process.stderr.write(`✗ ${r.name}\n`);
      }
    } catch (e) {
      failed++;
      process.stderr.write(`✗ ${r.name} (${e.message})\n`);
    }
  }));
  if (i + BATCH < rows.length) await sleep(200);
}

if (updates.length) {
  for (let i = 0; i < updates.length; i += 50) {
    await upsert('group_restaurants', updates.slice(i, i + 50), { onConflict: 'group_id,restaurant_id' });
  }
}
console.log(`\nDone. Fetched: ${fetched}, Skipped: ${skipped}, Failed: ${failed}`);
