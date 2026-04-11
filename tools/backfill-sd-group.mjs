#!/usr/bin/env node
// backfill-sd-group.mjs — One-time: dump webapp/data/restaurants.json into
// Supabase group_restaurants under the legacy SD group. Idempotent.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DATA_FILE = resolve(REPO_ROOT, 'webapp/data/restaurants.json');
const INDEX_HTML = resolve(REPO_ROOT, 'webapp/index.html');

// Parse Supabase URL + anon key from index.html (single source of truth)
const indexHtml = readFileSync(INDEX_HTML, 'utf-8');
const urlMatch = indexHtml.match(/window\.__SUPABASE_URL\s*=\s*['"]([^'"]+)['"]/);
const keyMatch = indexHtml.match(/window\.__SUPABASE_KEY\s*=\s*['"]([^'"]+)['"]/);
if (!urlMatch || !keyMatch) {
  console.error('Could not find Supabase URL/key in webapp/index.html');
  process.exit(1);
}
const SUPABASE_URL = urlMatch[1];
const SUPABASE_KEY = keyMatch[1];

const HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

async function pg(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: { ...HEADERS, ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${opts.method || 'GET'} ${path} → ${res.status} ${body}`);
  }
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

// 1. Find the legacy SD group
const groups = await pg('/groups?select=id,name,city_slug&city_slug=eq.san-diego&limit=1');
if (!groups?.length) {
  console.error('No group with city_slug=san-diego. Run the migration first.');
  process.exit(1);
}
const groupId = groups[0].id;
console.log(`Legacy SD group: ${groups[0].name} (id=${groupId})`);

// 2. Load local restaurants.json
const restaurants = JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
console.log(`Loaded ${restaurants.length} restaurants from ${DATA_FILE}`);

// 3. Upsert each into group_restaurants (batch)
const rows = restaurants.map(r => ({
  group_id: groupId,
  restaurant_id: r.id,
  data: r,
  status: 'active',
}));

// PostgREST upsert: use Prefer: resolution=merge-duplicates
const BATCH = 50;
let upserted = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const slice = rows.slice(i, i + BATCH);
  await pg('/group_restaurants', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify(slice),
  });
  upserted += slice.length;
  process.stderr.write(`  ${upserted}/${rows.length}\r`);
}
process.stderr.write('\n');

// 4. Verify
const count = await pg(`/group_restaurants?select=restaurant_id&group_id=eq.${groupId}`);
console.log(`✓ ${count.length} rows in group_restaurants for ${groupId}`);
console.log(`\nShare link: https://<your-vercel-domain>/?g=${groupId}`);
