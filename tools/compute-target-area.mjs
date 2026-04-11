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

function percentile(sorted, p) {
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[idx];
}

const lats = points.map(p => p.lat).sort((a, b) => a - b);
const lngs = points.map(p => p.lng).sort((a, b) => a - b);

// 5/95 percentile drops outliers (one place way outside the city should not dictate zoom)
const minLat = percentile(lats, 0.05);
const maxLat = percentile(lats, 0.95);
const minLng = percentile(lngs, 0.05);
const maxLng = percentile(lngs, 0.95);

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
console.log(`  points used: ${points.length}`);
