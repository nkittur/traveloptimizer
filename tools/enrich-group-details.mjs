#!/usr/bin/env node
// enrich-group-details.mjs — Fill googleRating / reviewCount / openingHours / price
// via Google Places API for active rows in group_restaurants.
// Usage: node tools/enrich-group-details.mjs <group-id> [--force]
//
// Pass --force to re-fetch even rows that already have a rating. Useful when
// new fields (price) are added to the pipeline after initial enrichment.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { selectOne, selectMany, upsert } from './_db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const groupId = process.argv[2];
const force = process.argv.includes('--force');
if (!groupId) { console.error('Usage: enrich-group-details.mjs <group-id> [--force]'); process.exit(1); }

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

async function searchPlace(name, address) {
  const query = address ? `${name} ${address}` : `${name} ${cityCtx}`;
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'places.rating,places.userRatingCount,places.currentOpeningHours,places.regularOpeningHours,places.priceLevel',
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 1, languageCode: 'en' }),
  });
  const j = await res.json();
  return j.places?.[0] || null;
}

function parseHours(place) {
  const hours = place.regularOpeningHours || place.currentOpeningHours;
  if (!hours) return null;
  const out = { weekdayText: hours.weekdayDescriptions || [], periods: [] };
  if (hours.periods) {
    for (const p of hours.periods) {
      out.periods.push({
        day: p.open?.day,
        open: p.open?.hour != null ? `${String(p.open.hour).padStart(2,'0')}:${String(p.open.minute||0).padStart(2,'0')}` : null,
        close: p.close?.hour != null ? `${String(p.close.hour).padStart(2,'0')}:${String(p.close.minute||0).padStart(2,'0')}` : null,
      });
    }
  }
  return out;
}

// Google Places v1 returns priceLevel as an enum string. Map to $-$$$$.
const PRICE_LEVEL_MAP = {
  PRICE_LEVEL_FREE: '$',
  PRICE_LEVEL_INEXPENSIVE: '$',
  PRICE_LEVEL_MODERATE: '$$',
  PRICE_LEVEL_EXPENSIVE: '$$$',
  PRICE_LEVEL_VERY_EXPENSIVE: '$$$$',
};

function parsePrice(place) {
  const raw = place.priceLevel;
  if (!raw) return null;
  return PRICE_LEVEL_MAP[raw] || null;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BATCH = 5;
let enriched = 0, skipped = 0, failed = 0;
const updates = [];

for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  await Promise.all(batch.map(async (row) => {
    const r = row.data || {};
    // Skip already-enriched rows unless --force OR price is missing (pipeline update)
    if (!force && r.googleRating != null && r.price != null) { skipped++; return; }
    try {
      const place = await searchPlace(r.name, r.address);
      if (place) {
        r.googleRating = place.rating || null;
        r.googleReviewCount = place.userRatingCount || null;
        r.openingHours = parseHours(place);
        // Google Places is authoritative for price — overwrite whatever was there
        const p = parsePrice(place);
        if (p) r.price = p;
        updates.push({ ...row, data: r });
        enriched++;
        const hrs = r.openingHours?.weekdayText?.length || 0;
        process.stderr.write(`✓ ${r.name} — ${r.googleRating}★ (${r.googleReviewCount}) ${r.price || '?'} ${hrs ? hrs + 'd' : ''}\n`);
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
console.log(`\nDone. Enriched: ${enriched}, Skipped: ${skipped}, Failed: ${failed}`);
