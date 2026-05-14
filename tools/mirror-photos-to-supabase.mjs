#!/usr/bin/env node
// mirror-photos-to-supabase.mjs — one-time migration that downloads every
// Google Places photo URL stored in group_restaurants.data.photos[] and
// data.photoUrl, uploads the bytes to Supabase Storage under a public bucket,
// and rewrites the row's photo URLs to the Supabase CDN.
//
// Why: rendering Places photos directly from googleapis.com bills us per
// <img> load — not CDN-cacheable, and the API key is baked into every URL.
// Hosting in Supabase Storage moves photo egress onto Supabase's free tier
// (1 GB storage + 2 GB egress/month covers our ~150 MB of thumbnails by a
// wide margin).
//
// Idempotent: already-mirrored URLs (anything not on googleapis.com) are
// skipped. Safe to re-run after adding new restaurants.
//
// Usage:
//   node tools/mirror-photos-to-supabase.mjs           # all groups
//   node tools/mirror-photos-to-supabase.mjs <group>   # one group
//   node tools/mirror-photos-to-supabase.mjs --dry     # preview only
//
// Requires:
//   .env → SUPABASE_SERVICE_ROLE_KEY=...  (from Dashboard → Settings → API)

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pg, selectMany, SUPABASE_URL } from './_db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const BUCKET = 'restaurant-photos';
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const groupArg = args.find(a => a !== '--dry');

// Load service-role key — required for bucket creation and anon-less uploads.
let SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  try {
    const env = readFileSync(resolve(REPO_ROOT, '.env'), 'utf-8');
    const m = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/);
    if (m) SERVICE_KEY = m[1].trim();
  } catch {}
}
if (!SERVICE_KEY) {
  console.error('No SUPABASE_SERVICE_ROLE_KEY in env or .env.');
  console.error('Grab it from Supabase dashboard → Project Settings → API → service_role.');
  process.exit(1);
}

const STORAGE_BASE = `${SUPABASE_URL}/storage/v1`;
const PUBLIC_BASE  = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}`;

async function ensureBucket() {
  const res = await fetch(`${STORAGE_BASE}/bucket/${BUCKET}`, {
    headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY },
  });
  if (res.ok) { console.log(`Bucket "${BUCKET}" already exists.`); return; }
  if (res.status !== 400 && res.status !== 404) {
    throw new Error(`bucket probe ${res.status} ${await res.text()}`);
  }
  // Create it — public, 5 MB file limit (plenty for 400px JPEGs).
  const create = await fetch(`${STORAGE_BASE}/bucket`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: BUCKET,
      name: BUCKET,
      public: true,
      file_size_limit: 5_000_000,
      allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'],
    }),
  });
  if (!create.ok) throw new Error(`bucket create ${create.status} ${await create.text()}`);
  console.log(`Created public bucket "${BUCKET}".`);
}

async function uploadBytes(path, bytes, contentType) {
  const res = await fetch(`${STORAGE_BASE}/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
      'Content-Type': contentType,
      // Overwrite silently if object already exists — keeps re-runs safe.
      'x-upsert': 'true',
      // Tell the Supabase CDN to cache aggressively.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
    body: bytes,
  });
  if (!res.ok) throw new Error(`upload ${path} → ${res.status} ${await res.text()}`);
  return `${PUBLIC_BASE}/${path}`;
}

function isGoogleUrl(u) {
  return typeof u === 'string' && /googleapis\.com/.test(u);
}

// Extract a stable filename from a Places photo URL so re-runs produce the
// same key (deduplicates across groups, though we key by group+restaurant
// index anyway). We key the object by {group}/{restaurant}/{index}.{ext}.
function extForContentType(ct) {
  if (/png/i.test(ct))  return 'jpg'; // normalize to jpg — bucket only allows image/*
  if (/webp/i.test(ct)) return 'webp';
  return 'jpg';
}

async function downloadPhoto(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const ct = res.headers.get('content-type') || 'image/jpeg';
  const buf = Buffer.from(await res.arrayBuffer());
  return { bytes: buf, contentType: ct };
}

async function mirrorOne(groupId, restaurantId, photos) {
  const next = [];
  for (let i = 0; i < photos.length; i++) {
    const url = photos[i];
    if (!url) continue;
    if (!isGoogleUrl(url)) { next.push(url); continue; } // already mirrored
    try {
      const { bytes, contentType } = await downloadPhoto(url);
      const ext = extForContentType(contentType);
      const key = `${groupId}/${restaurantId}/${i}.${ext}`;
      const publicUrl = await uploadBytes(key, bytes, contentType);
      next.push(publicUrl);
    } catch (e) {
      process.stderr.write(`  ! ${restaurantId}[${i}] ${e.message}\n`);
      next.push(url); // keep old URL so we don't lose it
    }
  }
  return next;
}

// ── Main ──

await ensureBucket();

// Pull rows — include removed too, since we still have their data and a user
// might browse the shortlist/trash. Filter by group if specified.
const filter = groupArg ? { group_id: groupArg } : {};
const rows = await selectMany('group_restaurants', filter, 'select=group_id,restaurant_id,data');
console.log(`Candidates: ${rows.length} rows ${groupArg ? `in group ${groupArg}` : 'across all groups'}`);

// Count what's actually pending
let pendingPhotos = 0, alreadyMirrored = 0;
for (const row of rows) {
  for (const u of (row.data?.photos || [])) {
    if (isGoogleUrl(u)) pendingPhotos++; else if (u) alreadyMirrored++;
  }
}
console.log(`Pending Google-hosted photos: ${pendingPhotos}`);
console.log(`Already mirrored:             ${alreadyMirrored}`);

if (dry) { console.log('Dry run — exiting.'); process.exit(0); }
if (pendingPhotos === 0) { console.log('Nothing to do.'); process.exit(0); }

let rowsUpdated = 0, photosMirrored = 0;
for (const row of rows) {
  const d = row.data || {};
  const pendingInRow = (d.photos || []).filter(isGoogleUrl).length;
  if (pendingInRow === 0) continue;
  const nextPhotos = await mirrorOne(row.group_id, row.restaurant_id, d.photos || []);
  const nextPrimary = isGoogleUrl(d.photoUrl)
    ? (nextPhotos.find(u => !isGoogleUrl(u)) || d.photoUrl)
    : d.photoUrl;
  d.photos = nextPhotos;
  d.photoUrl = nextPrimary;
  // Write back via raw PATCH — composite-PK update on jsonb.
  const path = `/group_restaurants?group_id=eq.${encodeURIComponent(row.group_id)}&restaurant_id=eq.${encodeURIComponent(row.restaurant_id)}`;
  await pg(path, { method: 'PATCH', body: JSON.stringify({ data: d }) });
  rowsUpdated++;
  const migrated = pendingInRow - nextPhotos.filter(isGoogleUrl).length;
  photosMirrored += migrated;
  process.stderr.write(`✓ ${d.name || row.restaurant_id}  (${migrated}/${pendingInRow} mirrored)\n`);
}

console.log(`\nDone. Rows updated: ${rowsUpdated}. Photos mirrored: ${photosMirrored}.`);
console.log(`Public URLs now point at: ${PUBLIC_BASE}/`);
