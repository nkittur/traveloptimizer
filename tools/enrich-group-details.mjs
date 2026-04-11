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
      'X-Goog-FieldMask': 'places.rating,places.userRatingCount,places.currentOpeningHours,places.regularOpeningHours,places.priceLevel,places.priceRange,places.reviews',
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

// Google Places v1 returns two price fields:
//   - priceLevel: enum (FREE/INEXPENSIVE/MODERATE/EXPENSIVE/VERY_EXPENSIVE)
//   - priceRange: { startPrice: { units, currencyCode }, endPrice?: {...} }
//
// priceLevel is stale for a non-trivial number of restaurants — ABaC (€260
// tasting menu, 3 Michelin stars) reports PRICE_LEVEL_INEXPENSIVE because
// someone's old user-submitted data says so. priceRange is newer, comes
// from actual monetary data, and matches reality. Prefer priceRange; only
// fall back to priceLevel when priceRange is missing.

// Approximate currency → USD conversion. Good enough for bucketing into
// four $-tiers; precision to the cent is irrelevant here.
const TO_USD = {
  USD: 1.00, EUR: 1.10, GBP: 1.27, CHF: 1.12, CAD: 0.73, AUD: 0.66, NZD: 0.61,
  JPY: 0.0067, KRW: 0.00072, CNY: 0.14, HKD: 0.13, SGD: 0.74, TWD: 0.031,
  MXN: 0.059, BRL: 0.19, ARS: 0.0012,
  INR: 0.012, THB: 0.029, VND: 0.000039, IDR: 0.000061, PHP: 0.018, MYR: 0.21,
  AED: 0.27, SAR: 0.27, ILS: 0.27, TRY: 0.029, ZAR: 0.054, EGP: 0.020,
  NOK: 0.093, SEK: 0.095, DKK: 0.148, PLN: 0.25, CZK: 0.044, HUF: 0.0028, RON: 0.22,
};

// USD thresholds: entry-level "starting price" bucketed into the four tiers.
// Calibrated against Barcelona test set: Bemba €10 → $, Taktika €20 → $$,
// Bar Cañete €30 → $$$, ABaC/Disfrutar €100 → $$$$.
const PRICE_THRESHOLDS_USD = [
  { max: 16, tier: '$' },     // cheap eats, €≤15
  { max: 33, tier: '$$' },    // casual sit-down, €15-30
  { max: 77, tier: '$$$' },   // nice dinner, €30-70
  { max: Infinity, tier: '$$$$' }, // fine dining, €70+
];

function priceRangeToTier(range) {
  const start = range?.startPrice;
  if (!start?.units) return null;
  const currency = start.currencyCode || 'USD';
  const rate = TO_USD[currency] ?? 1.0;
  const usd = Number(start.units) * rate;
  if (!Number.isFinite(usd)) return null;
  return PRICE_THRESHOLDS_USD.find(t => usd < t.max)?.tier || '$$$$';
}

const PRICE_LEVEL_MAP = {
  PRICE_LEVEL_FREE: '$',
  PRICE_LEVEL_INEXPENSIVE: '$',
  PRICE_LEVEL_MODERATE: '$$',
  PRICE_LEVEL_EXPENSIVE: '$$$',
  PRICE_LEVEL_VERY_EXPENSIVE: '$$$$',
};

function parsePrice(place) {
  // Prefer the structured priceRange (accurate, monetary). Only fall back
  // to the priceLevel enum when priceRange is absent — the enum is stale
  // for some restaurants (notably high-end ones).
  const fromRange = priceRangeToTier(place.priceRange);
  if (fromRange) return fromRange;
  const raw = place.priceLevel;
  if (!raw) return null;
  return PRICE_LEVEL_MAP[raw] || null;
}

// Google Places reviews — up to 5 user reviews with text + star rating.
// Stored as a compact shape the webapp can render without extra lookup.
function parseReviews(place) {
  const list = place.reviews;
  if (!Array.isArray(list) || !list.length) return null;
  return list
    .filter(r => r?.text?.text?.trim().length > 20)
    .map(r => ({
      author: r.authorAttribution?.displayName || 'Anonymous',
      rating: r.rating || null,
      text: r.text.text.trim(),
      time: r.relativePublishTimeDescription || null,
    }))
    .slice(0, 5);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BATCH = 5;
let enriched = 0, skipped = 0, failed = 0;
const updates = [];

for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  await Promise.all(batch.map(async (row) => {
    const r = row.data || {};
    // Skip already-enriched rows unless --force OR a new field is missing (pipeline update).
    // googleReviews was added after initial enrichment — treat its absence as "needs refetch".
    const hasAll = r.googleRating != null && r.price != null && r.googleReviews !== undefined;
    if (!force && hasAll) { skipped++; return; }
    try {
      const place = await searchPlace(r.name, r.address);
      if (place) {
        r.googleRating = place.rating || null;
        r.googleReviewCount = place.userRatingCount || null;
        r.openingHours = parseHours(place);
        r.googleReviews = parseReviews(place); // null if none
        // Google Places is authoritative for price — overwrite whatever was there
        const p = parsePrice(place);
        if (p) r.price = p;
        updates.push({ ...row, data: r });
        enriched++;
        const hrs = r.openingHours?.weekdayText?.length || 0;
        const revs = r.googleReviews?.length || 0;
        process.stderr.write(`✓ ${r.name} — ${r.googleRating}★ (${r.googleReviewCount}) ${r.price || '?'} ${hrs ? hrs + 'd' : ''}${revs ? ` ${revs}rev` : ''}\n`);
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
