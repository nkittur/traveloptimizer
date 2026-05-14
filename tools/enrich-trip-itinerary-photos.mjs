#!/usr/bin/env node
// enrich-trip-itinerary-photos.mjs
// For each itinerary slot in a trip, query Google Places Text Search for the
// slot's place_name (scoped by destination), fetch the lead photo, upload it
// to Supabase Storage (bucket: trip-photos), and insert a metadata row into
// trip_destination_photos with bucket='itinerary-slot' and source_url set to
// the Google Maps URL — the renderer uses that as the click-through link.
//
// Usage:
//   node tools/enrich-trip-itinerary-photos.mjs <trip-id>
//   node tools/enrich-trip-itinerary-photos.mjs <trip-id> --force   # overwrite existing slot photos
//   node tools/enrich-trip-itinerary-photos.mjs <trip-id> --dry     # log queries, no fetch/upload

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { selectOne, selectMany, pg, SUPABASE_URL } from './_db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const BUCKET = 'trip-photos';
const PHOTO_MAX_WIDTH = 1200;       // larger than restaurant cards — used as background image
const STORAGE_BASE = `${SUPABASE_URL}/storage/v1`;

const tripId = process.argv[2];
const force = process.argv.includes('--force');
const dry = process.argv.includes('--dry');
if (!tripId) { console.error('Usage: enrich-trip-itinerary-photos.mjs <trip-id> [--force] [--dry]'); process.exit(1); }

// Load API keys
let API_KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!API_KEY) {
  try {
    const env = readFileSync(resolve(REPO_ROOT, '.env'), 'utf-8');
    const m = env.match(/GOOGLE_MAPS_API_KEY=(.+)/);
    if (m) API_KEY = m[1].trim();
  } catch {}
}
if (!API_KEY) { console.error('No GOOGLE_MAPS_API_KEY in env or .env'); process.exit(1); }

let SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  try {
    const env = readFileSync(resolve(REPO_ROOT, '.env'), 'utf-8');
    const m = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/);
    if (m) SERVICE_KEY = m[1].trim();
  } catch {}
}
if (!SERVICE_KEY) { console.error('No SUPABASE_SERVICE_ROLE_KEY in env or .env'); process.exit(1); }

const trip = await selectOne('trips', { id: tripId });
if (!trip) { console.error(`No trip ${tripId}`); process.exit(2); }

const dests = await selectMany('trip_destinations', { trip_id: tripId },
  'select=id,slug,name,country,itinerary&status=eq.finalist');

console.log(`Trip: ${trip.name}`);
console.log(`Finalists: ${dests.length}`);

// What's already in the DB so --force is opt-in
const existing = await selectMany('trip_destination_photos', {},
  `trip_destination_id=in.(${dests.map(d => d.id).join(',')})&bucket=eq.itinerary-slot&select=trip_destination_id,itinerary_slot_key`);
const existingKeys = new Set(existing.map(p => `${p.trip_destination_id}|${p.itinerary_slot_key}`));

async function searchPlace(query) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.googleMapsUri,places.location,places.photos',
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 1, languageCode: 'en' }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`searchText ${res.status} ${body.slice(0,200)}`);
  }
  const j = await res.json();
  return j.places?.[0] || null;
}

async function downloadPhoto(photoRef) {
  const url = `https://places.googleapis.com/v1/${photoRef}/media?maxWidthPx=${PHOTO_MAX_WIDTH}&key=${API_KEY}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`photo download ${res.status}`);
  const ct = res.headers.get('content-type') || 'image/jpeg';
  const buf = Buffer.from(await res.arrayBuffer());
  return { bytes: buf, contentType: ct };
}

function ext(ct) {
  if (/webp/i.test(ct)) return 'webp';
  if (/png/i.test(ct))  return 'png';
  return 'jpg';
}

async function upload(path, bytes, contentType) {
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

let inserted = 0, skipped = 0, missing = 0, failed = 0;

for (const dest of dests) {
  const itin = dest.itinerary || [];
  process.stderr.write(`\n[${dest.slug}] ${itin.length} days\n`);

  for (const day of itin) {
    for (const slot of (day.slots || [])) {
      const slotKey = slot.key || `${day.day}-${slot.type}`;
      const placeName = slot.place_name;
      if (!placeName || placeName === '—') { missing++; continue; }
      if (!force && existingKeys.has(`${dest.id}|${slotKey}`)) { skipped++; continue; }

      // Build a query that includes the destination context for disambiguation
      const cityCtx = [dest.name, dest.country].filter(Boolean).join(', ');
      const query = `${placeName}, ${cityCtx}`;

      try {
        if (dry) { process.stderr.write(`  · ${slotKey}: "${query}"\n`); continue; }

        const place = await searchPlace(query);
        if (!place) {
          missing++;
          process.stderr.write(`  ✗ ${slotKey}: no match for "${query}"\n`);
          continue;
        }
        const photoRef = place.photos?.[0]?.name;
        if (!photoRef) {
          missing++;
          process.stderr.write(`  ✗ ${slotKey}: no photo for "${place.displayName?.text || placeName}"\n`);
          continue;
        }

        const { bytes, contentType } = await downloadPhoto(photoRef);
        const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
        const path = `${tripId}/${dest.slug}/itin-${slotKey}-${hash}.${ext(contentType)}`;
        await upload(path, bytes, contentType);

        const mapsUri = place.googleMapsUri
          || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}&query_place_id=${place.id}`;

        // Replace any existing row for this slot if --force
        if (force) {
          await pg(`/trip_destination_photos?trip_destination_id=eq.${dest.id}&bucket=eq.itinerary-slot&itinerary_slot_key=eq.${encodeURIComponent(slotKey)}`,
            { method: 'DELETE' });
        }

        await pg('/trip_destination_photos', {
          method: 'POST',
          body: JSON.stringify({
            trip_destination_id: dest.id,
            storage_path: path,
            source_url: mapsUri,
            source_name: 'Google Places',
            caption: place.displayName?.text || placeName,
            alt_text: place.formattedAddress || placeName,
            section: 'Itinerary',
            bucket: 'itinerary-slot',
            itinerary_slot_key: slotKey,
            place_mentions: [placeName],
            perceptual_hash: hash,
            attribution: 'Photo: Google Places',
            rank: 0,
          }),
        });

        existingKeys.add(`${dest.id}|${slotKey}`);
        inserted++;
        process.stderr.write(`  ✓ ${slotKey}: ${place.displayName?.text || placeName}\n`);
      } catch (e) {
        failed++;
        process.stderr.write(`  ✗ ${slotKey}: ${e.message}\n`);
      }

      // Polite pacing — Google Places is fine but easy on it
      await new Promise(r => setTimeout(r, 100));
    }
  }
}

console.log(`\n✓ Itinerary photo enrichment complete`);
console.log(`  Inserted:           ${inserted}`);
console.log(`  Skipped (exists):   ${skipped}`);
console.log(`  Missing place/photo: ${missing}`);
console.log(`  Failed:             ${failed}`);
console.log(`Share link: https://webapp-rust-phi.vercel.app/?t=${tripId}`);
