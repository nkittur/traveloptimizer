#!/usr/bin/env node
// fetch-photos.mjs — Fetch multiple photos per restaurant from Google Places API
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DATA_FILE = resolve(__dirname, 'data/restaurants.json');
const MAX_PHOTOS = 5;

let API_KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!API_KEY) {
  try {
    const envFile = readFileSync(resolve(REPO_ROOT, '.env'), 'utf-8');
    const match = envFile.match(/GOOGLE_MAPS_API_KEY=(.+)/);
    if (match) API_KEY = match[1].trim();
  } catch {}
}
if (!API_KEY) { console.error('No GOOGLE_MAPS_API_KEY found'); process.exit(1); }

const restaurants = JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
const BATCH_SIZE = 5;
const DELAY = 200;

async function searchPlace(name, address) {
  const query = address ? `${name} ${address}` : `${name} San Diego CA`;
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'places.photos',
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 1, languageCode: 'en' }),
  });
  const data = await res.json();
  const photos = data.places?.[0]?.photos;
  if (!photos?.length) return [];
  return photos.slice(0, MAX_PHOTOS).map(p => p.name);
}

function photoUrl(photoName, maxWidth = 400) {
  return `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${maxWidth}&key=${API_KEY}`;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  let fetched = 0, skipped = 0, failed = 0;

  for (let i = 0; i < restaurants.length; i += BATCH_SIZE) {
    const batch = restaurants.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (r) => {
      // Skip if already has multiple photos
      if (r.photos?.length > 1) { skipped++; return; }
      try {
        const photoNames = await searchPlace(r.name, r.address);
        if (photoNames.length) {
          r.photos = photoNames.map(n => photoUrl(n));
          r.photoUrl = r.photos[0]; // keep backward compat
          fetched++;
          process.stderr.write(`✓ ${r.name} (${photoNames.length} photos)\n`);
        } else {
          failed++;
          process.stderr.write(`✗ ${r.name}\n`);
        }
      } catch (err) {
        failed++;
        process.stderr.write(`✗ ${r.name} (${err.message})\n`);
      }
    }));
    if (i + BATCH_SIZE < restaurants.length) await sleep(DELAY);
  }

  writeFileSync(DATA_FILE, JSON.stringify(restaurants, null, 2));
  console.log(`\nDone. Fetched: ${fetched}, Skipped: ${skipped}, Failed: ${failed}`);
}

main();
