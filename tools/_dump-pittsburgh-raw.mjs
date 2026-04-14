#!/usr/bin/env node
// Dump all raw composition inputs for Pittsburgh restaurants so we can
// hand-craft Zagat-style descriptions.
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pg, slugify } from './_db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// Load raw source files
const eaterRaw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'eater-pittsburgh-raw.json'), 'utf-8'));
const infatuationRaw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'infatuation-pittsburgh-raw.json'), 'utf-8'));
const pittmagRaw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'pittmag-pittsburgh-raw.json'), 'utf-8'));
const fullJson = JSON.parse(readFileSync(resolve(REPO_ROOT, 'trips/places/pittsburgh-full.json'), 'utf-8'));

// Build lookups keyed by slug
const eaterBySlug = new Map();
for (const it of eaterRaw) eaterBySlug.set(slugify(it.name), it);

const infBySlug = new Map();
for (const it of infatuationRaw) infBySlug.set(slugify(it.name), it);

const pmBySlug = new Map();
for (const it of pittmagRaw) pmBySlug.set(slugify(it.name), it);

// Load reddit threads
const redditThreads = [];
for (let i = 1; i <= 3; i++) {
  try {
    const d = JSON.parse(readFileSync(resolve(REPO_ROOT, `reddit-thread-${i}.json`), 'utf-8'));
    redditThreads.push(d);
  } catch { redditThreads.push({ comments: [] }); }
}

// Canonical merges for slug lookups
const SLUG_ALIASES = {
  'chengdu-gourmet': ['chengdu-gourmet-2', 'chengdu-gourmet'],
  'alta-via': ['alta-via-multiple-locations', 'alta-via'],
  'dish-osteria-bar': ['dish-osteria-bar', 'dish-osteria-and-bar'],
  'eyv': ['eyv', 'eyv-restaurant'],
  'hyeholde': ['hyeholde', 'hyeholde-restaurant'],
  'tessaros': ['tessaros', 'tessaros-american-bar-hardwood-grill'],
  'hidden-harbor': ['hidden-harbor', 'hidden-harborindependent-brewing-company'],
  'fet-fisk': ['fet-fisk'],
};

function findInMap(map, slug) {
  const direct = map.get(slug);
  if (direct) return direct;
  for (const [canonical, aliases] of Object.entries(SLUG_ALIASES)) {
    if (canonical === slug || aliases.includes(slug)) {
      for (const a of aliases) {
        const found = map.get(a);
        if (found) return found;
      }
    }
  }
  return null;
}

// Query DB for Google reviews
const dbRows = await pg('/group_restaurants?group_id=eq.wp2j8ihe&status=eq.active&select=restaurant_id,data');
const dbBySlug = new Map(dbRows.map(r => [r.restaurant_id, r.data]));

// Generate composition inputs
const out = [];
out.push(`# Pittsburgh composition inputs\n`);
out.push(`# ${fullJson.length} restaurants\n\n`);

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

  const eater = findInMap(eaterBySlug, r.id);
  const inf = findInMap(infBySlug, r.id);
  const pm = findInMap(pmBySlug, r.id);
  const dbRow = dbBySlug.get(r.id);

  // Reddit mentions
  const redditSource = r.sources.find(s => s.type === 'reddit');
  if (redditSource) {
    out.push(`\n  REDDIT: ${redditSource.mentions} thread${redditSource.mentions > 1 ? 's' : ''}`);
  }

  if (eater?.review) {
    out.push(`\n  --- EATER ---`);
    out.push(`  ${eater.review.replace(/\n+/g, ' ').slice(0, 1500)}`);
  }
  if (inf?.review) {
    out.push(`\n  --- INFATUATION ---`);
    out.push(`  ${inf.review.replace(/\n+/g, ' ').slice(0, 1500)}`);
  }
  if (pm?.review) {
    out.push(`\n  --- PITTSBURGH MAGAZINE ---`);
    out.push(`  ${pm.review.replace(/\n+/g, ' ').slice(0, 1500)}`);
  }

  // Google reviews from DB
  if (dbRow?.googleReviews?.length) {
    out.push(`\n  --- GOOGLE (top ${Math.min(5, dbRow.googleReviews.length)}) ---`);
    for (const rev of dbRow.googleReviews.slice(0, 5)) {
      out.push(`  [${rev.rating}★] ${(rev.text || '').replace(/\n+/g, ' ').slice(0, 400)}`);
    }
  }
  if (dbRow) {
    out.push(`\n  META: ${dbRow.googleRating}★ (${dbRow.googleReviewCount} reviews) ${dbRow.price || '?'} · ${dbRow.neighborhood || ''}`);
  }
}

const outPath = resolve(REPO_ROOT, 'trips/places/pittsburgh-composition-input.txt');
writeFileSync(outPath, out.join('\n'));
console.log(`Wrote ${fullJson.length} restaurant inputs → ${outPath}`);
console.log(`File size: ${(out.join('\n').length / 1024).toFixed(1)} KB`);
