#!/usr/bin/env node
// mirror-trip-photos.mjs — download photos referenced by trip-destination
// scrapes, upload them to Supabase Storage (bucket: trip-photos), and insert
// metadata rows into trip_destination_photos.
//
// Sibling of mirror-photos-to-supabase.mjs (which is a one-time migration for
// already-stored Google Places URLs). This tool is the *forward* path: it
// turns scrape-extracted image URLs into self-hosted assets.
//
// Input via stdin — JSON shape:
//   {
//     "trip_id": "<token>",
//     "destinations": [
//       {
//         "slug": "lisbon-portugal",
//         "photos": [
//           {
//             "source_url": "https://...",
//             "caption":    "The lobby at Memmo Alfama",
//             "alt_text":   "...",
//             "source_name":"NYT 36 Hours",
//             "section":    "Where to Stay",
//             "bucket":     "boutique-stay",
//             "itinerary_slot_key": null,
//             "place_mentions": ["Memmo Alfama"],
//             "attribution": "Photo: Daniel Rodrigues / NYT",
//             "rank":       0
//           },
//           ...
//         ]
//       }
//     ]
//   }
//
// Usage:
//   node tools/mirror-trip-photos.mjs < photos.json
//   node tools/mirror-trip-photos.mjs --dry < photos.json   # preview only

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { pg, selectOne, selectMany, SUPABASE_URL } from './_db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const BUCKET = 'trip-photos';
const args = process.argv.slice(2);
const dry = args.includes('--dry');

let SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  try {
    const env = readFileSync(resolve(REPO_ROOT, '.env'), 'utf-8');
    const m = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/);
    if (m) SERVICE_KEY = m[1].trim();
  } catch {}
}
if (!SERVICE_KEY) {
  console.error('No SUPABASE_SERVICE_ROLE_KEY — set in env or .env.');
  process.exit(1);
}

const STORAGE_BASE = `${SUPABASE_URL}/storage/v1`;
const PUBLIC_BASE  = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}`;

function extForContentType(ct) {
  if (/png/i.test(ct))  return 'png';
  if (/webp/i.test(ct)) return 'webp';
  if (/avif/i.test(ct)) return 'avif';
  return 'jpg';
}

async function downloadPhoto(url) {
  // Wikimedia is strict — needs an identifying UA with contact and respects 429.
  const headers = {
    'User-Agent': 'traveloptimizer/1.0 (https://github.com/nkittur; nkittur@andrew.cmu.edu) Node/22',
    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { redirect: 'follow', headers });
    if (res.ok) {
      const ct  = res.headers.get('content-type') || 'image/jpeg';
      const buf = Buffer.from(await res.arrayBuffer());
      return { bytes: buf, contentType: ct };
    }
    if (res.status === 429 || res.status >= 500) {
      const waitMs = 600 * Math.pow(2, attempt);   // 0.6s, 1.2s, 2.4s, 4.8s
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }
    throw new Error(`download ${res.status}`);
  }
  throw new Error('download 429 (after retries)');
}

async function uploadBytes(path, bytes, contentType) {
  const res = await fetch(`${STORAGE_BASE}/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
      'Content-Type': contentType,
      'x-upsert': 'true',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
    body: bytes,
  });
  if (!res.ok) throw new Error(`upload ${path} → ${res.status} ${await res.text()}`);
  return path;
}

// Read input
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const raw = Buffer.concat(chunks).toString('utf-8').trim();
if (!raw) {
  console.error('No stdin — pipe a photo manifest JSON.');
  process.exit(2);
}
const manifest = JSON.parse(raw);
const tripId = manifest.trip_id;
if (!tripId) { console.error('manifest.trip_id required'); process.exit(3); }
const trip = await selectOne('trips', { id: tripId });
if (!trip) { console.error(`No trip ${tripId}`); process.exit(4); }

// Index destinations by slug
const dests = await selectMany('trip_destinations', { trip_id: tripId });
const destBySlug = new Map(dests.map(d => [d.slug, d]));

// Existing photos for cross-photo dedupe within trip. The dedupe key combines
// (destination, bucket, itinerary_slot_key, hash) so the same image can legitimately
// appear in different buckets/slots without being dropped — we only block exact
// duplicates within the same slot.
const existingPhotos = dests.length
  ? await selectMany('trip_destination_photos', {},
      `trip_destination_id=in.(${dests.map(d => d.id).join(',')})&select=trip_destination_id,perceptual_hash,bucket,itinerary_slot_key,storage_path`)
  : [];
const seenKeys = new Set(existingPhotos
  .filter(p => p.perceptual_hash)
  .map(p => `${p.trip_destination_id}|${p.bucket}|${p.itinerary_slot_key || ''}|${p.perceptual_hash}`));

let inserted = 0, deduped = 0, failed = 0;

for (const destIn of manifest.destinations || []) {
  const dest = destBySlug.get(destIn.slug);
  if (!dest) {
    console.error(`! Unknown destination slug "${destIn.slug}" — skipping`);
    continue;
  }
  const photos = destIn.photos || [];
  process.stderr.write(`\n[${dest.slug}] ${photos.length} photos\n`);
  for (const p of photos) {
    if (!p.source_url || !p.bucket) {
      console.error(`! ${dest.slug}: photo missing source_url or bucket — skipping`);
      continue;
    }
    if (dry) { process.stderr.write(`  · ${p.bucket}: ${p.source_url}\n`); continue; }
    try {
      // Polite pacing for Wikimedia + similar.
      await new Promise(r => setTimeout(r, 220));
      const { bytes, contentType } = await downloadPhoto(p.source_url);
      const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
      const dedupeKey = `${dest.id}|${p.bucket}|${p.itinerary_slot_key || ''}|${hash}`;
      if (seenKeys.has(dedupeKey)) { deduped++; process.stderr.write(`  ↺ dup: ${p.bucket}\n`); continue; }
      seenKeys.add(dedupeKey);

      const ext = extForContentType(contentType);
      const path = `${tripId}/${dest.slug}/${p.bucket}-${hash}.${ext}`;
      await uploadBytes(path, bytes, contentType);

      // Naive dimensions — would need sharp for real width/height. Leave null;
      // renderer can use intrinsic image size.
      await pg('/trip_destination_photos', {
        method: 'POST',
        body: JSON.stringify({
          trip_destination_id: dest.id,
          storage_path: path,
          source_url: p.source_url,
          source_name: p.source_name || null,
          caption: p.caption || null,
          alt_text: p.alt_text || null,
          section: p.section || null,
          bucket: p.bucket,
          itinerary_slot_key: p.itinerary_slot_key || null,
          place_mentions: p.place_mentions || [],
          perceptual_hash: hash,
          attribution: p.attribution || null,
          rank: p.rank ?? null,
        }),
      });
      inserted++;
      process.stderr.write(`  ✓ ${p.bucket}${p.itinerary_slot_key ? ' ['+p.itinerary_slot_key+']' : ''}\n`);
    } catch (e) {
      failed++;
      process.stderr.write(`  ✗ ${p.bucket}: ${e.message}\n`);
    }
  }
}

console.log(`\nDone. Inserted: ${inserted}. Deduped: ${deduped}. Failed: ${failed}.`);
console.log(`Public URLs: ${PUBLIC_BASE}/<storage_path>`);
console.log(`Share link: https://webapp-rust-phi.vercel.app/?t=${tripId}`);
