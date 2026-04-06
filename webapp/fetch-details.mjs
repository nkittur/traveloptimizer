#!/usr/bin/env node
// fetch-details.mjs — Enrich restaurants with Google Places ratings + opening hours
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
const BATCH_SIZE = 5;
const DELAY = 200;

async function searchPlace(name, address) {
  const query = address ? `${name} ${address}` : `${name} San Diego CA`;
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'places.rating,places.userRatingCount,places.currentOpeningHours,places.regularOpeningHours,places.priceLevel',
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 1, languageCode: 'en' }),
  });
  const data = await res.json();
  return data.places?.[0] || null;
}

function parseHours(place) {
  const hours = place.regularOpeningHours || place.currentOpeningHours;
  if (!hours) return null;

  const result = {
    weekdayText: hours.weekdayDescriptions || [],
    periods: [],
  };

  if (hours.periods) {
    for (const p of hours.periods) {
      result.periods.push({
        day: p.open?.day,
        open: p.open?.hour != null ? `${String(p.open.hour).padStart(2,'0')}:${String(p.open.minute||0).padStart(2,'0')}` : null,
        close: p.close?.hour != null ? `${String(p.close.hour).padStart(2,'0')}:${String(p.close.minute||0).padStart(2,'0')}` : null,
      });
    }
  }

  return result;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  let enriched = 0, skipped = 0, failed = 0;

  for (let i = 0; i < restaurants.length; i += BATCH_SIZE) {
    const batch = restaurants.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (r) => {
      if (r.googleRating != null) { skipped++; return; }
      try {
        const place = await searchPlace(r.name, r.address);
        if (place) {
          r.googleRating = place.rating || null;
          r.googleReviewCount = place.userRatingCount || null;
          r.openingHours = parseHours(place);
          enriched++;
          const hrs = r.openingHours?.weekdayText?.length || 0;
          process.stderr.write(`✓ ${r.name} — ${r.googleRating}★ (${r.googleReviewCount} reviews) ${hrs ? hrs + ' days' : 'no hours'}\n`);
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
  console.log(`\nDone. Enriched: ${enriched}, Skipped: ${skipped}, Failed: ${failed}`);

  const withRating = restaurants.filter(r => r.googleRating).length;
  const withHours = restaurants.filter(r => r.openingHours?.periods?.length).length;
  console.log(`  With ratings: ${withRating}, With hours: ${withHours}`);
}

main();
