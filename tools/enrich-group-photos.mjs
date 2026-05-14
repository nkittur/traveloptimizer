#!/usr/bin/env node
// [DEPRECATED — use enrich-group-combined.mjs]
// enrich-group-photos.mjs — Fill photos[] via Google Places API, downloading
// the bytes and uploading them to Supabase Storage so the webapp never links
// directly to googleapis.com (that endpoint isn't CDN-cacheable and every
// rendered <img> bills against the Places Photos SKU).
//
// Output on the row: data.photos[] = array of Supabase public CDN URLs;
// data.photoUrl = data.photos[0]. No Google URLs ever get persisted.
//
// Usage: node tools/enrich-group-photos.mjs <group-id> [--force]
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { selectOne, selectMany, upsert } from './_db.mjs';
import { ensureBucket, uploadBytes, downloadImage, extForContentType } from './_storage.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const MAX_PHOTOS = 5;
const PHOTO_MAX_WIDTH = 400;

const groupId = process.argv[2];
const force = process.argv.includes('--force');
if (!groupId) { console.error('Usage: enrich-group-photos.mjs <group-id> [--force]'); process.exit(1); }

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

await ensureBucket();

const rows = await selectMany('group_restaurants',
  { group_id: groupId, status: 'active' },
  'select=group_id,restaurant_id,data');
console.log(`${group.name}: ${rows.length} active rows`);

const cityCtx = [group.city_name, group.country].filter(Boolean).join(' ');

async function searchPhotoRefs(name, address) {
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
  if (!res.ok) throw new Error(`searchText ${res.status}`);
  const j = await res.json();
  const photos = j.places?.[0]?.photos;
  if (!photos?.length) return [];
  return photos.slice(0, MAX_PHOTOS).map(p => p.name); // e.g. "places/XYZ/photos/ABC"
}

function googlePhotoUrl(photoRef) {
  return `https://places.googleapis.com/v1/${photoRef}/media?maxWidthPx=${PHOTO_MAX_WIDTH}&key=${API_KEY}`;
}

async function mirrorOne(groupId, restaurantId, photoRef, index) {
  const src = googlePhotoUrl(photoRef);
  const { bytes, contentType } = await downloadImage(src);
  const ext = extForContentType(contentType);
  const key = `${groupId}/${restaurantId}/${index}.${ext}`;
  return uploadBytes(key, bytes, contentType);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BATCH = 5;
let enriched = 0, skipped = 0, failed = 0;
const updates = [];

for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  await Promise.all(batch.map(async (row) => {
    const r = row.data || {};
    // Skip already-mirrored rows (photos are non-Google URLs) unless --force.
    const hasSupabasePhotos = r.photos?.length > 0
      && r.photos.every(u => u && !/googleapis\.com/.test(u));
    if (!force && hasSupabasePhotos) { skipped++; return; }
    try {
      const refs = await searchPhotoRefs(r.name, r.address);
      if (!refs.length) { failed++; process.stderr.write(`✗ ${r.name} (no refs)\n`); return; }
      const urls = [];
      for (let idx = 0; idx < refs.length; idx++) {
        try {
          const url = await mirrorOne(row.group_id, row.restaurant_id, refs[idx], idx);
          urls.push(url);
        } catch (e) {
          process.stderr.write(`  ! ${r.name}[${idx}] ${e.message}\n`);
        }
      }
      if (!urls.length) { failed++; return; }
      r.photos = urls;
      r.photoUrl = urls[0];
      updates.push({ ...row, data: r });
      enriched++;
      process.stderr.write(`✓ ${r.name} (${urls.length}/${refs.length} photos)\n`);
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
console.log(`\nDone. Fetched: ${enriched}, Skipped: ${skipped}, Failed: ${failed}`);
