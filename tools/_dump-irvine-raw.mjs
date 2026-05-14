#!/usr/bin/env node
// _dump-irvine-raw.mjs — Dump editorial + Google review raw text for each
// active row, to use as input for hand-crafting descriptions (Pass 2).
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { selectMany } from './_db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const groupId = 'n4exwctn';
const rows = await selectMany('group_restaurants',
  { group_id: groupId, status: 'active' },
  'select=restaurant_id,data');

// Load compose input (editorial raw) from normalizer output
const composeInputPath = resolve(REPO_ROOT, 'trips/places/irvine-compose-input.json');
const composeInput = JSON.parse(readFileSync(composeInputPath, 'utf-8'));
const composeById = Object.fromEntries(composeInput.map(e => [e.id, e]));

let out = '';
const DROPPED_IDS = new Set([
  "kayas-kitchen", "annapoorna", "bangkok-corner", "charminar-indian-kitchen",
  "chiang-rai", "elephant-thai-cafe", "hanbop", "india-gate", "india-kitchen",
  "natraj-cuisine-of-india", "yoos-place", "manaao-thai", "thai-kitchen", "thai-cafe"
]);

for (const row of rows) {
  if (DROPPED_IDS.has(row.restaurant_id)) continue;
  const d = row.data || {};
  const c = composeById[row.restaurant_id] || {};
  out += `\n${'='.repeat(70)}\n`;
  out += `${d.name} (id=${row.restaurant_id})\n`;
  out += `  cuisine: ${d.cuisine || '?'}\n`;
  out += `  neighborhood: ${d.neighborhood || '?'}\n`;
  out += `  address: ${d.address || '?'}\n`;
  out += `  price: ${d.price || '?'} | google: ${d.googleRating || '?'}★ (${d.googleReviewCount || 0})\n`;
  out += `  outdoorSeating: ${d.outdoorSeating}\n`;
  out += `  sources: ${(d.sources || []).map(s => s.type + (s.distinction ? `:${s.distinction}` : '')).join(', ')}\n`;
  if (c._rawDescs) {
    for (const [k, v] of Object.entries(c._rawDescs)) {
      if (!v) continue;
      out += `\n  [${k}] ${v}\n`;
    }
  }
  if (d.googleReviews && d.googleReviews.length) {
    out += `\n  [google reviews]\n`;
    for (const r of d.googleReviews) {
      out += `    - ${r.rating || '?'}★ (${r.author || 'anon'}): ${(r.text || '').replace(/\s+/g, ' ').trim().slice(0, 400)}\n`;
    }
  }
}

const dumpPath = resolve(REPO_ROOT, 'trips/places/irvine-compose-dump.txt');
writeFileSync(dumpPath, out);
console.log(`Dumped raw composition input → ${dumpPath} (${out.length} chars)`);
