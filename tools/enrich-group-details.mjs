#!/usr/bin/env node
// enrich-group-details.mjs — Fill googleRating / reviewCount / openingHours
// via Google Places API for active rows in group_restaurants.
// Usage: node tools/enrich-group-details.mjs <group-id>
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { selectOne, selectMany, upsert } from './_db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const groupId = process.argv[2];
if (!groupId) { console.error('Usage: enrich-group-details.mjs <group-id>'); process.exit(1); }

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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BATCH = 5;
let enriched = 0, skipped = 0, failed = 0;
const updates = [];

for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  await Promise.all(batch.map(async (row) => {
    const r = row.data || {};
    if (r.googleRating != null) { skipped++; return; }
    try {
      const place = await searchPlace(r.name, r.address);
      if (place) {
        r.googleRating = place.rating || null;
        r.googleReviewCount = place.userRatingCount || null;
        r.openingHours = parseHours(place);
        updates.push({ ...row, data: r });
        enriched++;
        const hrs = r.openingHours?.weekdayText?.length || 0;
        process.stderr.write(`✓ ${r.name} — ${r.googleRating}★ (${r.googleReviewCount}) ${hrs ? hrs + 'd' : ''}\n`);
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
