#!/usr/bin/env node
// compute-target-area.mjs — After geocoding, set groups.target_area / default_center / default_zoom
// from the 95th-percentile bounding box of geocoded points (drops outliers).
// Usage: node tools/compute-target-area.mjs <group-id>
import { selectOne, selectMany, update } from './_db.mjs';

const groupId = process.argv[2];
if (!groupId) { console.error('Usage: compute-target-area.mjs <group-id>'); process.exit(1); }

const group = await selectOne('groups', { id: groupId });
if (!group) { console.error(`No group ${groupId}`); process.exit(2); }

const rows = await selectMany('group_restaurants',
  { group_id: groupId, status: 'active' },
  'select=data');
const points = rows
  .map(r => r.data)
  .filter(d => typeof d?.lat === 'number' && typeof d?.lng === 'number')
  .map(d => ({ lat: d.lat, lng: d.lng }));

if (points.length < 3) {
  console.error(`Not enough geocoded points (${points.length}). Run geocode first.`);
  process.exit(3);
}

// Iterative outlier drop from the geographic median outward. Matches the
// `coreBounds` logic in webapp/js/map.js so the server-computed target_area
// agrees with what the webapp renders. See that file for the full comment.
const latsSorted = [...points].map(p => p.lat).sort((a, b) => a - b);
const lngsSorted = [...points].map(p => p.lng).sort((a, b) => a - b);
const medLat = latsSorted[Math.floor(latsSorted.length / 2)];
const medLng = lngsSorted[Math.floor(lngsSorted.length / 2)];

const ranked = points
  .map(p => ({ p, d: Math.hypot(p.lat - medLat, p.lng - medLng) }))
  .sort((a, b) => a.d - b.d);

const minKept = Math.max(10, Math.ceil(points.length * 0.9));
const RATIO_GAP = 3;
const ABSOLUTE_GAP = 0.05;
while (ranked.length > minKept) {
  const last = ranked[ranked.length - 1];
  const prev = ranked[ranked.length - 2];
  const outlier = last.d > prev.d * RATIO_GAP || (last.d - prev.d) > ABSOLUTE_GAP;
  if (!outlier) break;
  ranked.pop();
}
const kept = ranked.map(x => x.p);

let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
for (const p of kept) {
  if (p.lat < minLat) minLat = p.lat;
  if (p.lat > maxLat) maxLat = p.lat;
  if (p.lng < minLng) minLng = p.lng;
  if (p.lng > maxLng) maxLng = p.lng;
}

const center = {
  lat: (minLat + maxLat) / 2,
  lng: (minLng + maxLng) / 2,
};

// Rough zoom calc: fit the bbox in ~400px × 400px
const latSpan = maxLat - minLat;
const lngSpan = maxLng - minLng;
const span = Math.max(latSpan, lngSpan);
// World = 360°, zoom 0. Each zoom halves the span.
const zoom = span > 0
  ? Math.max(9, Math.min(15, Math.round(Math.log2(360 / span)) - 1))
  : 12;

const targetArea = {
  bbox: { minLat, minLng, maxLat, maxLng },
  point_count: points.length,
  kept_count: kept.length,
};

await update('groups', { id: groupId }, {
  target_area: targetArea,
  default_center: center,
  default_zoom: zoom,
});

console.log(`✓ Updated group ${groupId}`);
console.log(`  bbox: (${minLat.toFixed(4)}, ${minLng.toFixed(4)}) → (${maxLat.toFixed(4)}, ${maxLng.toFixed(4)})`);
console.log(`  center: ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`);
console.log(`  zoom: ${zoom}`);
console.log(`  points used: ${kept.length} of ${points.length} (${points.length - kept.length} outliers dropped)`);
