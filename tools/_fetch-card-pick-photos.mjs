#!/usr/bin/env node
// _fetch-card-pick-photos.mjs
// For each finalist, walk agree_picks + food_picks. For each pick that doesn't
// have a matching photo (per the same place_mentions/caption matching the
// renderer uses), fetch a Google Places photo and upload to Supabase.
//
// Bucket assignment: reuses the existing schema's allowed values:
//   restaurant/cafe/bar → 'foodie'
//   museum/park/landmark/sight/shop → 'natural-beauty'
//   hotel (n/a, hotels go through other path) → 'boutique-stay'
//
// Run: node tools/_fetch-card-pick-photos.mjs <trip-id>

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { selectMany, pg, SUPABASE_URL } from './_db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const tripId = process.argv[2];
if (!tripId) { console.error('Usage: _fetch-card-pick-photos.mjs <trip-id>'); process.exit(1); }

let API_KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!API_KEY) {
  try { const m = readFileSync(resolve(REPO_ROOT, '.env'), 'utf-8').match(/GOOGLE_MAPS_API_KEY=(.+)/); if (m) API_KEY = m[1].trim(); } catch {}
}
let SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  try { const m = readFileSync(resolve(REPO_ROOT, '.env'), 'utf-8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/); if (m) SERVICE_KEY = m[1].trim(); } catch {}
}
if (!API_KEY || !SERVICE_KEY) { console.error('Missing API keys'); process.exit(1); }

function bucketFor(category) {
  if (['restaurant', 'cafe', 'bar'].includes(category)) return 'foodie';
  if (['museum', 'park', 'landmark', 'sight', 'shop'].includes(category)) return 'natural-beauty';
  return 'natural-beauty';
}

// Mirrors findPhotoForPlace in trip.js — looks for an existing photo whose
// place_mentions or caption matches the place name.
function hasMatchingPhoto(name, photos) {
  if (!name) return false;
  const lower = name.toLowerCase().trim();
  if (lower.length < 3) return true; // skip too-short to avoid spurious fetch
  for (const p of photos) {
    const mentions = (p.place_mentions || []).map(s => s.toLowerCase());
    if (mentions.some(m => m === lower || m.includes(lower) || lower.includes(m))) return true;
    if (lower.length >= 5 && (p.caption || '').toLowerCase().includes(lower)) return true;
  }
  return false;
}

const dests = await selectMany('trip_destinations', { trip_id: tripId },
  'select=id,slug,name,operational&status=eq.finalist');

const allPhotos = await selectMany('trip_destination_photos', {},
  `trip_destination_id=in.(${dests.map(d => d.id).join(',')})&select=trip_destination_id,place_mentions,caption,bucket`);

const photosByDest = {};
for (const p of allPhotos) (photosByDest[p.trip_destination_id] ||= []).push(p);

let totalMissing = 0, fetched = 0, failed = 0, skipped = 0;
const fetchPlan = [];

// Phase 1: collect missing
for (const d of dests) {
  const op = d.operational || {};
  const picks = [...(op.agree_picks || []), ...(op.food_picks || [])];
  const photos = photosByDest[d.id] || [];
  for (const pick of picks) {
    if (hasMatchingPhoto(pick.name, photos)) continue;
    fetchPlan.push({ dest: d, pick });
    totalMissing++;
  }
}

console.log(`Total missing: ${totalMissing} card photos across ${dests.length} finalists`);
if (process.argv.includes('--dry')) {
  for (const fp of fetchPlan) console.log(`  · ${fp.dest.slug} → ${fp.pick.name} (${fp.pick.category})`);
  process.exit(0);
}

const STORAGE_BASE = `${SUPABASE_URL}/storage/v1`;

for (const { dest, pick } of fetchPlan) {
  const query = `${pick.name}, ${dest.name}`;
  try {
    // Search Google Places
    const sr = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.googleMapsUri,places.photos',
      },
      body: JSON.stringify({ textQuery: query, maxResultCount: 1, languageCode: 'en' }),
    });
    if (!sr.ok) throw new Error(`searchText ${sr.status}`);
    const sj = await sr.json();
    const place = sj.places?.[0];
    const photoRef = place?.photos?.[0]?.name;
    if (!photoRef) { skipped++; process.stderr.write(`  · ${dest.slug}: no place/photo for "${query}"\n`); continue; }

    // Download
    const photoUrl = `https://places.googleapis.com/v1/${photoRef}/media?maxWidthPx=1200&key=${API_KEY}`;
    const dl = await fetch(photoUrl, { redirect: 'follow' });
    if (!dl.ok) throw new Error(`dl ${dl.status}`);
    const bytes = Buffer.from(await dl.arrayBuffer());
    const ct = dl.headers.get('content-type') || 'image/jpeg';
    const ext = /webp/i.test(ct) ? 'webp' : 'jpg';
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
    const bucket = bucketFor(pick.category);
    // Use a name-safe path component
    const slugName = pick.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    const path = `${tripId}/${dest.slug}/pick-${slugName}-${hash}.${ext}`;

    // Upload
    const up = await fetch(`${STORAGE_BASE}/object/trip-photos/${path}`, {
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
        trip_destination_id: dest.id,
        storage_path: path,
        source_url: place.googleMapsUri || null,
        source_name: 'Google Places',
        caption: place.displayName?.text || pick.name,
        bucket,
        place_mentions: [pick.name],
        perceptual_hash: hash,
        attribution: 'Photo: Google Places',
      }),
    });
    fetched++;
    process.stderr.write(`  ✓ ${dest.slug.padEnd(28)} ${pick.category.padEnd(10)} ${pick.name}\n`);
    await new Promise(r => setTimeout(r, 150));
  } catch (e) {
    failed++;
    process.stderr.write(`  ✗ ${dest.slug}: ${pick.name} → ${e.message}\n`);
  }
}

console.log(`\n✓ Done. Fetched ${fetched}, skipped ${skipped}, failed ${failed} of ${totalMissing} missing.`);
