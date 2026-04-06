#!/usr/bin/env node
// geocode.mjs — Add lat/lng to restaurants.json via Google Geocoding API
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DATA_FILE = resolve(__dirname, 'data/restaurants.json');

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

async function geocode(query) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.results?.length) {
    return data.results[0].geometry.location; // { lat, lng }
  }
  return null;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  let geocoded = 0, skipped = 0, failed = 0;

  for (const r of restaurants) {
    if (r.lat != null && r.lng != null) { skipped++; continue; }

    const query = r.address
      ? `${r.name} ${r.address}`
      : `${r.name} ${r.neighborhood || ''} San Diego CA`;

    const loc = await geocode(query);
    if (loc) {
      r.lat = loc.lat;
      r.lng = loc.lng;
      geocoded++;
      process.stderr.write(`✓ ${r.name} → ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}\n`);
    } else {
      failed++;
      process.stderr.write(`✗ ${r.name} (query: ${query})\n`);
    }
    await sleep(50);
  }

  writeFileSync(DATA_FILE, JSON.stringify(restaurants, null, 2));
  console.log(`\nDone. Geocoded: ${geocoded}, Skipped: ${skipped}, Failed: ${failed}`);
}

main();
