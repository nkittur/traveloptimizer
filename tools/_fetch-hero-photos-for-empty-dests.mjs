#!/usr/bin/env node
// _fetch-hero-photos-for-empty-dests.mjs
// For each destination on a trip with NO photos at all, fetch a single Google Places
// photo (using the destination name as the query) and insert it as bucket='hero'.
// One-shot helper for the round-3 "show all destinations" UI.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { selectMany, pg, SUPABASE_URL } from './_db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const tripId = process.argv[2];
if (!tripId) { console.error('Usage: _fetch-hero-photos-for-empty-dests.mjs <trip-id>'); process.exit(1); }

let API_KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!API_KEY) {
  try { const m = readFileSync(resolve(REPO_ROOT, '.env'), 'utf-8').match(/GOOGLE_MAPS_API_KEY=(.+)/); if (m) API_KEY = m[1].trim(); } catch {}
}
let SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  try { const m = readFileSync(resolve(REPO_ROOT, '.env'), 'utf-8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/); if (m) SERVICE_KEY = m[1].trim(); } catch {}
}
if (!API_KEY || !SERVICE_KEY) { console.error('Missing API keys'); process.exit(1); }

const dests = await selectMany('trip_destinations', { trip_id: tripId },
  'select=id,slug,name,country&status=eq.finalist');

// Find which have no photos
const photos = await selectMany('trip_destination_photos', {},
  `trip_destination_id=in.(${dests.map(d => d.id).join(',')})&select=trip_destination_id`);
const photoCountByDest = {};
for (const p of photos) photoCountByDest[p.trip_destination_id] = (photoCountByDest[p.trip_destination_id] || 0) + 1;

const empty = dests.filter(d => !photoCountByDest[d.id]);
console.log(`${dests.length} finalists, ${empty.length} with no photos: ${empty.map(d => d.slug).join(', ')}`);

let inserted = 0;
for (const d of empty) {
  const query = [d.name, d.country].filter(Boolean).join(', ');
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.photos,places.googleMapsUri',
      },
      body: JSON.stringify({ textQuery: query, maxResultCount: 1, languageCode: 'en' }),
    });
    if (!res.ok) throw new Error(`searchText ${res.status}`);
    const j = await res.json();
    const place = j.places?.[0];
    const photoRef = place?.photos?.[0]?.name;
    if (!photoRef) { process.stderr.write(`  ✗ ${d.slug}: no photo for "${query}"\n`); continue; }

    const photoUrl = `https://places.googleapis.com/v1/${photoRef}/media?maxWidthPx=1200&key=${API_KEY}`;
    const dl = await fetch(photoUrl, { redirect: 'follow' });
    if (!dl.ok) throw new Error(`photo dl ${dl.status}`);
    const bytes = Buffer.from(await dl.arrayBuffer());
    const ct = dl.headers.get('content-type') || 'image/jpeg';
    const ext = /webp/i.test(ct) ? 'webp' : 'jpg';
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
    const path = `${tripId}/${d.slug}/hero-${hash}.${ext}`;

    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/trip-photos/${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        'Content-Type': ct,
        'x-upsert': 'true',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
      body: bytes,
    });
    if (!up.ok) throw new Error(`upload ${up.status}`);

    await pg('/trip_destination_photos', {
      method: 'POST',
      body: JSON.stringify({
        trip_destination_id: d.id,
        storage_path: path,
        source_url: place.googleMapsUri || null,
        source_name: 'Google Places',
        caption: place.displayName?.text || d.name,
        bucket: 'hero',
        place_mentions: [d.name],
        perceptual_hash: hash,
        attribution: 'Photo: Google Places',
        rank: 0,
      }),
    });
    inserted++;
    process.stderr.write(`  ✓ ${d.slug}\n`);
    await new Promise(r => setTimeout(r, 200));
  } catch (e) {
    process.stderr.write(`  ✗ ${d.slug}: ${e.message}\n`);
  }
}

console.log(`\nInserted ${inserted} hero photos.`);
