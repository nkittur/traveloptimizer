#!/usr/bin/env node
// Fix SD reddit sources so each restaurant's thread list reflects which threads
// actually mention it, not the full 11-thread universe.
//
// Root cause of the original bug: the earlier SD retrofit attached SD_REDDIT_THREADS
// (all 11) to every reddit source. That disagreed with the scraped `mentions`
// count — e.g. The Marine Room showed "3 reddit mentions" but listed 11 threads.
//
// This script reads 7 freshly scraped thread files at repo root
// (reddit-sd-thread-{1..7}.json), scans each SD restaurant name against all
// comment bodies (case-insensitive literal substring), and writes back
// per-restaurant threads[]. If no thread mentions a restaurant (because its
// mention count came from a Google snippet of a source we couldn't re-scrape),
// drops the threads[] field entirely — the detail view then renders the
// mentions count without a misleading thread list.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { selectMany, upsert } from './_db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const GROUP_ID = 'fgvy96yg';

// The 7 actual scraped threads (the original retrofit's 4 "placeholder" entries
// — bare r/FoodSanDiego, r/sandiego etc. — aren't real threads and are dropped.)
const THREADS = [
  { file: 'reddit-sd-thread-1.json', url: 'https://www.reddit.com/r/FoodSanDiego/comments/1ljq6yg/la_jolla_day_where_to_hit/' },
  { file: 'reddit-sd-thread-2.json', url: 'https://www.reddit.com/r/FoodSanDiego/comments/1gs8hhm/must_try_food_in_la_jolla/' },
  { file: 'reddit-sd-thread-3.json', url: 'https://www.reddit.com/r/FoodSanDiego/comments/1qxquq8/what_are_some_decent_restaurants_in_la_jolla_that/' },
  { file: 'reddit-sd-thread-4.json', url: 'https://www.reddit.com/r/FoodSanDiego/comments/1or4bt6/fine_dining_near_la_jolla/' },
  { file: 'reddit-sd-thread-5.json', url: 'https://www.reddit.com/r/FoodSanDiego/comments/1elp15q/la_jolla_restaurants_with_a_view_that_arent/' },
  { file: 'reddit-sd-thread-6.json', url: 'https://www.reddit.com/r/FoodSanDiego/comments/x4fzt0/best_nice_restaurant_in_la_jolla/' },
  { file: 'reddit-sd-thread-7.json', url: 'https://www.reddit.com/r/FoodSanDiego/comments/1lmusdd/midhighend_restaurants_that_are_actually_worth_it/' },
];

// Load thread files. Each is { title, post, commentCount, comments: [{score, body}] }.
const loaded = THREADS.map(t => {
  const p = path.join(ROOT, t.file);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  // Concatenate post + all comment bodies into one searchable blob, lowercased.
  const blob = [j.post || '', ...j.comments.map(c => c.body)].join('\n').toLowerCase();
  return { title: j.title, url: t.url, blob };
});

console.log(`Loaded ${loaded.length} thread files`);

// Hand-curated aliases for SD restaurants whose canonical name in threads
// differs from the Google Places name. Extend this rather than making the
// fuzzy match looser (which introduces false positives).
const ALIASES = {
  "George's At The Cove": ["george's", 'georges california modern', 'george\'s cove', 'george\'s california'],
  'Nine-Ten Restaurant and Bar': ['nine-ten', 'nine ten'],
  'A.R. Valentien': ['a.r. valentien', 'ar valentien', 'valentien'],
  'Harumama (Blue Ocean)': ['harumama'],
  'Wayfarer Bakery': ['wayfarer'],
  "Mitch's Seafood": ["mitch's seafood", 'mitch\'s'],
  'Bistro du Marché by Tapenade': ['bistro du marche', 'bistro du marché', 'tapenade'],
  'Caroline\'s Seaside Cafe': ['caroline\'s', 'carolines seaside'],
  'Fort Oak': ['fort oak'],
  'Dumpling Inn': ['dumpling inn'],
  'Shan Xi Magic Kitchen': ['shan xi', 'shanxi magic'],
  'Panchitas Kitchen': ['panchitas', 'panchita\'s'],
  'Azteca Taco Shop': ['azteca taco'],
  'Leila': ['leila'],
  'Queenstown': ['queenstown'],
  'Yasai': ['yasai'],
};

// Candidate name forms to try for a restaurant.
function candidates(name) {
  const out = new Set();
  const clean = name.replace(/\s+/g, ' ').trim();
  out.add(clean.toLowerCase());
  if (/^the\s+/i.test(clean)) out.add(clean.replace(/^the\s+/i, '').toLowerCase());
  if (/\s+restaurant$/i.test(clean)) out.add(clean.replace(/\s+restaurant$/i, '').toLowerCase());
  // Strip parenthetical suffixes like "Harumama (Blue Ocean)" → "harumama"
  if (/\s*\([^)]+\)\s*$/.test(clean)) out.add(clean.replace(/\s*\([^)]+\)\s*$/, '').toLowerCase());
  if (clean.includes('&')) out.add(clean.replace(/&/g, 'and').toLowerCase());
  if (/\band\b/i.test(clean)) out.add(clean.replace(/\band\b/gi, '&').toLowerCase());
  // Hand-curated aliases
  for (const alias of (ALIASES[clean] || [])) out.add(alias.toLowerCase());
  return [...out].filter(s => s.length >= 4);
}

function matchThreads(name) {
  const cands = candidates(name);
  const matched = [];
  for (const t of loaded) {
    if (cands.some(c => t.blob.includes(c))) {
      matched.push({ title: t.title, url: t.url });
    }
  }
  return matched;
}

const rows = await selectMany('group_restaurants',
  { group_id: GROUP_ID, status: 'active' },
  'select=group_id,restaurant_id,data');
console.log(`Loaded ${rows.length} active SD restaurants`);

const updates = [];
let touched = 0;
let matchedAny = 0;
let matchedNone = 0;

for (const row of rows) {
  const r = row.data || {};
  const sources = Array.isArray(r.sources) ? r.sources : [];
  let changed = false;

  for (const s of sources) {
    if (s.type !== 'reddit') continue;
    const matched = matchThreads(r.name || '');
    if (matched.length > 0) {
      matchedAny++;
      s.threads = matched;
      // Reconcile mentions with threads.length so badge ("N Reddit recs") and
      // detail view ("N threads") agree. The old mentions count came from a
      // Google-snippet heuristic and was no longer accurate.
      s.mentions = matched.length;
      s.detail = `r/FoodSanDiego — ${matched.length} thread${matched.length === 1 ? '' : 's'}`;
      changed = true;
    } else {
      matchedNone++;
      // No thread mentions this restaurant. The old `mentions` count came
      // from a Google snippet that pointed at threads we can't re-verify.
      // Drop the reddit source entirely — an unverifiable "N Reddit recs"
      // badge is worse than no badge.
      sources.splice(sources.indexOf(s), 1);
      changed = true;
      break; // only one reddit source per row; list mutated
    }
  }

  if (changed) {
    touched++;
    updates.push({ ...row, data: { ...r, sources } });
  }
}

console.log(`Matched threads for: ${matchedAny} restaurants`);
console.log(`No thread match for: ${matchedNone} restaurants (threads[] dropped)`);
console.log(`Rows touched: ${touched} / ${rows.length}`);

if (!updates.length) {
  console.log('Nothing to update.');
  process.exit(0);
}

const BATCH = 50;
for (let i = 0; i < updates.length; i += BATCH) {
  const slice = updates.slice(i, i + BATCH);
  await upsert('group_restaurants', slice, { onConflict: 'group_id,restaurant_id' });
  process.stderr.write(`  upserted ${Math.min(i + BATCH, updates.length)}/${updates.length}\r`);
}
process.stderr.write('\n');

console.log('✓ SD reddit threads retrofitted per-restaurant');
console.log(`  Verify: https://webapp-rust-phi.vercel.app/?g=${GROUP_ID}`);
