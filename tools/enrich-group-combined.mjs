#!/usr/bin/env node
// enrich-group-combined.mjs — Single-pass Places enrichment.
//
// Replaces the old four-script chain (geocode → details → photos → outdoor)
// with ONE Places API call per row. Extracts every field we care about from
// a single response:
//   lat/lng, formattedAddress, googleRating, googleReviewCount, openingHours,
//   price, googleReviews, outdoorSeating, photos, placeId
//
// Photos are downloaded and uploaded to Supabase Storage inline so no Google
// URLs ever reach the browser.
//
// Caching: the raw Place response is stashed on the row as data.placeRaw,
// with a data.placeRawFetchedAt timestamp. Within 90 days, re-runs just
// re-parse the stored raw — zero API calls — unless --force is passed.
//
// Usage: node tools/enrich-group-combined.mjs <group-id> [--force]
//
// The --force flag triggers a confirmation prompt with a cost estimate
// (~$0.05 per row at Atmosphere tier) before proceeding.
import { createInterface } from 'readline/promises';
import { selectOne, selectMany, upsert } from './_db.mjs';
import {
  API_KEY,
  fetchPlace,
  parseLocation,
  parseHours,
  parsePrice,
  parseReviews,
  parseOutdoorSeating,
  parsePhotoRefs,
  googlePhotoUrl,
} from './_places.mjs';
import { ensureBucket, uploadBytes, downloadImage, extForContentType } from './_storage.mjs';

const PHOTO_MAX_WIDTH = 400;
const MAX_PHOTOS = 5;
const APPROX_COST_PER_ROW_USD = 0.05;  // Atmosphere tier Text Search, rough

const args = process.argv.slice(2);
const force = args.includes('--force');
const groupId = args.find(a => !a.startsWith('--'));
if (!groupId) { console.error('Usage: enrich-group-combined.mjs <group-id> [--force]'); process.exit(1); }

const group = await selectOne('groups', { id: groupId });
if (!group) { console.error(`No group ${groupId}`); process.exit(2); }

const rows = await selectMany('group_restaurants',
  { group_id: groupId, status: 'active' },
  'select=group_id,restaurant_id,data');
console.log(`${group.name}: ${rows.length} active rows`);

// --force is destructive-ish (re-bills Google for every row). Confirm before
// proceeding so we don't accidentally burn $20 on a fat groupa.
if (force) {
  const estimate = (rows.length * APPROX_COST_PER_ROW_USD).toFixed(2);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `--force will re-fetch ${rows.length} rows at ~$${APPROX_COST_PER_ROW_USD}/row = ~$${estimate}. Type YES to proceed: `
  );
  rl.close();
  if (answer.trim() !== 'YES') { console.log('Aborted.'); process.exit(0); }
}

await ensureBucket();

const cityCtx = [group.city_name, group.country].filter(Boolean).join(' ');

// Mirror one Google photo ref into Supabase Storage; returns the public URL.
async function mirrorPhoto(groupId, restaurantId, photoRef, index) {
  const src = googlePhotoUrl(photoRef, { maxWidthPx: PHOTO_MAX_WIDTH });
  const { bytes, contentType } = await downloadImage(src);
  const ext = extForContentType(contentType);
  const key = `${groupId}/${restaurantId}/${index}.${ext}`;
  return uploadBytes(key, bytes, contentType);
}

function isSupabasePhoto(u) {
  return typeof u === 'string' && !/googleapis\.com/.test(u) && u.length > 0;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BATCH = 4; // conservative — photo uploads are I/O heavy

let enriched = 0, cached = 0, refreshed = 0, failed = 0, totalApiCalls = 0;
const updates = [];

for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  await Promise.all(batch.map(async (row) => {
    const d = row.data || {};
    // Build the text query. DELIBERATELY avoid d.neighborhood — hand-written
    // neighborhood hints have caused misrouted matches (L20, L13: "Restaurant
    // Ki Beverly Hills area" → Nua in Beverly Hills; "Nina's Kitchen Lake
    // Forest" → Salvadorian pupusas instead of the Indian spot). The city
    // from the group row IS ground truth and narrows the match enough.
    const query = d.address ? `${d.name} ${d.address}` : `${d.name} ${cityCtx}`.trim();

    try {
      const { place, source, match } = await fetchPlace({ row: d, query, intendedName: d.name, force });
      if (!place) {
        failed++;
        process.stderr.write(`✗ ${d.name} (no match)\n`);
        return;
      }
      if (source === 'cache') cached++;
      else { totalApiCalls++; if (source === 'details') refreshed++; }

      // If verifyNameMatch rejected the candidate, don't commit its fields
      // to the row. Log the mismatch loudly so the caller can fix the name/
      // aliases or supply a placeId manually.
      if (match && match.ok === false) {
        failed++;
        process.stderr.write(
          `✗ ${d.name} — NAME MISMATCH: Places returned "${match.gotName}" (${match.reason}). ` +
          `Data NOT committed; placeId not stored. Add a more specific alias or manually set data.placeId.\n`
        );
        return;
      }

      // ── Extract fields from the (possibly cached) raw response ──
      const loc = parseLocation(place);
      if (loc) { d.lat = loc.lat; d.lng = loc.lng; }
      if (place.formattedAddress && !d.address) d.address = place.formattedAddress;
      d.googleRating = place.rating ?? null;
      d.googleReviewCount = place.userRatingCount ?? null;
      d.openingHours = parseHours(place);
      d.googleReviews = parseReviews(place);
      d.outdoorSeating = parseOutdoorSeating(place);
      const newPrice = parsePrice(place);
      if (newPrice) d.price = newPrice;
      if (place.websiteUri && !d.website) d.website = place.websiteUri;

      // ── Photos: mirror any new refs. Keep existing Supabase URLs if the
      //    refs haven't changed (we key by position, so if the Google refs
      //    shifted we re-upload — cost is a handful of photo fetches, not
      //    a billing-tier delta).
      const refs = parsePhotoRefs(place, MAX_PHOTOS);
      const existing = Array.isArray(d.photos) ? d.photos : [];
      const allSupabase = existing.length === refs.length && existing.every(isSupabasePhoto);
      if (refs.length && (force || !allSupabase)) {
        const urls = [];
        for (let idx = 0; idx < refs.length; idx++) {
          try {
            const url = await mirrorPhoto(row.group_id, row.restaurant_id, refs[idx], idx);
            urls.push(url);
          } catch (e) {
            process.stderr.write(`  ! ${d.name}[photo ${idx}] ${e.message}\n`);
          }
        }
        if (urls.length) {
          d.photos = urls;
          d.photoUrl = urls[0];
        }
      }

      updates.push({ ...row, data: d });
      enriched++;
      const tag = source === 'cache' ? 'cache' : source === 'details' ? 'id  ' : 'srch';
      process.stderr.write(
        `✓ [${tag}] ${d.name.padEnd(34)} ${d.googleRating || '?'}★ ` +
        `(${d.googleReviewCount || 0}) ${d.price || '?'} ` +
        `outdoor=${String(d.outdoorSeating).padEnd(5)} ` +
        `rev=${d.googleReviews?.length || 0} ` +
        `photos=${d.photos?.length || 0}\n`
      );
    } catch (e) {
      failed++;
      process.stderr.write(`✗ ${d.name} (${e.message})\n`);
    }
  }));
  if (i + BATCH < rows.length) await sleep(200);
}

if (updates.length) {
  for (let i = 0; i < updates.length; i += 50) {
    await upsert('group_restaurants', updates.slice(i, i + 50), { onConflict: 'group_id,restaurant_id' });
  }
}

const estCost = (totalApiCalls * APPROX_COST_PER_ROW_USD).toFixed(2);
console.log(`\nDone. Enriched: ${enriched}, Cached: ${cached}, Refreshed via id: ${refreshed}, Failed: ${failed}`);
console.log(`API calls made: ${totalApiCalls} (~$${estCost})`);
