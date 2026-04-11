#!/usr/bin/env node
// One-off: dump all raw composition inputs for Barcelona restaurants to a text
// file so I can read them all at once while hand-crafting descriptions.
//
// For each restaurant in barcelona-full.json, includes:
//   - the merged sources list
//   - CNT dek / Eater review / Time Out prose (whatever scrape source had)
//   - Michelin star count
//   - 50 Best rank
//   - Top 3 Google reviews (from the DB — the live enrichment data)
//
// Output: trips/places/barcelona-composition-input.txt
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pg, slugify } from './_db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// Load raw source files
const cntRaw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'cnt-barcelona-raw.json'), 'utf-8'));
const eaterRaw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'eater-barcelona-raw.json'), 'utf-8'));
const michelinRaw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'michelin-barcelona-raw.json'), 'utf-8'));
const timeoutRaw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'trips/places/barcelona-test.json'), 'utf-8'));
const fullJson = JSON.parse(readFileSync(resolve(REPO_ROOT, 'trips/places/barcelona-full.json'), 'utf-8'));

// Build lookups keyed by slug
function slugsFromName(name) {
  return slugify(name);
}

const cntBySlug = new Map();
for (const it of cntRaw) {
  // Clean HTML entities
  const name = String(it.name).replace(/&amp;/g, '&').replace(/&apos;/g, "'");
  cntBySlug.set(slugify(name), { name, dek: it.originalVenue?.dek || '', rank: cntRaw.indexOf(it) + 1 });
}

const eaterBySlug = new Map();
for (const it of eaterRaw) {
  eaterBySlug.set(slugify(it.name), { name: it.name, review: it.review || '', rank: eaterRaw.indexOf(it) + 1 });
}

const michelinBySlug = new Map();
const STAR_LABEL = {
  THREE_STARS: '★★★', TWO_STARS: '★★', ONE_STAR: '★', BIB_GOURMAND: 'Bib Gourmand',
};
for (const it of michelinRaw) {
  michelinBySlug.set(slugify(it.name), { name: it.name, star: STAR_LABEL[it.distinction] || it.distinction });
}

const timeoutBySlug = new Map();
for (const it of timeoutRaw) {
  timeoutBySlug.set(slugify(it.name), it);
}

// Hand-curated 50 Best (same list the normalizer uses)
const best50 = {
  enigma: { rank: 34, year: 2025 },
  'cocina-hermanos-torres': { rank: 78, year: 2025 },
  disfrutar: { rank: 1, year: 2024 },
};

// Hand-curated Reddit — note which restaurants had mentions
const redditMentions = {
  'mont-bar': 2, 'maleducat': 1, 'koy-shunka': 1, 'batea': 1, 'besta': 1,
  'xuba-tacos': 1, 'ultramarinos-marin': 1,
  'yakumanka': 2, 'el-pachuco': 3, 'xerta-restaurant': 2, 'bar-h': 2,
  'dos-pebrots': 1, 'somodo': 1, 'julivert-meu': 1,
};

// Query DB for Google reviews
const dbRows = await pg('/group_restaurants?group_id=eq.jemttfrg&status=eq.active&select=restaurant_id,data');
const dbBySlug = new Map(dbRows.map(r => [r.restaurant_id, r.data]));

// Generate composition inputs
const out = [];
out.push(`# Barcelona composition inputs\n`);
out.push(`# ${fullJson.length} restaurants\n\n`);

// Sort by source count desc (multi-source first) then alphabetical
const sorted = [...fullJson].sort((a, b) => {
  if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length;
  return a.name.localeCompare(b.name);
});

for (const r of sorted) {
  const sources = r.sources.map(s => s.type).join(', ');
  out.push(`\n========================================`);
  out.push(`[${r.sources.length}×] ${r.name} (${r.id})`);
  out.push(`SOURCES: ${sources}`);
  out.push(`========================================`);

  // Try to find the CNT / Eater / Michelin / Time Out entries
  const cnt = cntBySlug.get(r.id) || [...cntBySlug.values()].find(c => slugify(c.name) === r.id);
  const eater = eaterBySlug.get(r.id) || [...eaterBySlug.values()].find(e => slugify(e.name) === r.id);
  const mich = michelinBySlug.get(r.id) || [...michelinBySlug.values()].find(m => slugify(m.name) === r.id);
  const tout = timeoutBySlug.get(r.id) || [...timeoutBySlug.values()].find(t => slugify(t.name) === r.id);
  const b50 = best50[r.id];
  const redditN = redditMentions[r.id];

  if (mich) out.push(`\n  MICHELIN: ${mich.star}`);
  if (b50) out.push(`  50 BEST: #${b50.rank} (${b50.year})`);
  if (cnt?.rank) out.push(`  CNT RANK: #${cnt.rank}/34`);
  if (eater?.rank) out.push(`  EATER RANK: #${eater.rank}/38`);
  if (redditN) out.push(`  REDDIT: ${redditN} mention${redditN > 1 ? 's' : ''}`);

  if (cnt?.dek) {
    out.push(`\n  --- CNT ---`);
    out.push(`  ${cnt.dek.trim().replace(/\n+/g, ' ').slice(0, 1500)}`);
  }
  if (eater?.review) {
    out.push(`\n  --- EATER ---`);
    out.push(`  ${eater.review.trim().replace(/\n+/g, ' ').slice(0, 1500)}`);
  }
  if (tout?.highlights) {
    out.push(`\n  --- TIME OUT ---`);
    out.push(`  ${tout.highlights.trim()}`);
    if (tout.insiderTip) out.push(`  TIP: ${tout.insiderTip}`);
  }

  // Google reviews from DB
  const dbRow = dbBySlug.get(r.id);
  if (dbRow?.googleReviews?.length) {
    out.push(`\n  --- GOOGLE (top ${Math.min(3, dbRow.googleReviews.length)}) ---`);
    for (const rev of dbRow.googleReviews.slice(0, 3)) {
      out.push(`  [${rev.rating}★] ${rev.text.replace(/\n+/g, ' ').slice(0, 400)}`);
    }
  }
  if (dbRow) {
    out.push(`\n  META: ${dbRow.googleRating}★ (${dbRow.googleReviewCount} reviews) ${dbRow.price || '?'} · ${dbRow.neighborhood || ''}`);
  }
}

const outPath = resolve(REPO_ROOT, 'trips/places/barcelona-composition-input.txt');
writeFileSync(outPath, out.join('\n'));
console.log(`Wrote ${fullJson.length} restaurant inputs → ${outPath}`);
console.log(`File size: ${(out.join('\n').length / 1024).toFixed(1)} KB`);
