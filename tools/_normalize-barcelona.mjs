#!/usr/bin/env node
// _normalize-barcelona.mjs — Merge all Barcelona sources (Time Out, CNT,
// Michelin, Eater, World's 50 Best) into a single normalized JSON with
// cross-source overlap detection.
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { slugify } from './_db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// ── Text cleanup helpers ──

function unesc(s) {
  if (!s) return s;
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, '\u2019')
    .replace(/&lsquo;/g, '\u2018')
    .replace(/&rdquo;/g, '\u201d')
    .replace(/&ldquo;/g, '\u201c')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
    .replace(/\s*\{:\s*[^}]+\}/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstSentences(s, n = 3, max = 500) {
  if (!s) return null;
  const clean = unesc(s);
  const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean];
  return sentences.slice(0, n).join(' ').trim().slice(0, max) || null;
}

// ── Canonical merge table — explicit, hand-verified ──
//
// Each key is a raw slug (what slugify() produces from a source's display name).
// Each value is the canonical {slug, name} that raw entries should be merged into.
// This replaces heuristic fuzzy matching — every entry here is a human judgment
// call that "these are the same restaurant". New cities add their own table.
//
// To add an entry:
//   1. node -e "import('./tools/_db.mjs').then(m => console.log(m.slugify('<source name>')))"
//   2. Pick the canonical {slug, name} — usually the shortest/cleanest display name
//   3. Add the raw slug here, pointing to the canonical pair
const CANONICAL_MERGES = {
  // Lasarte (Martín Berasategui's 3-star) — CNT calls it "Restaurante Lasarte"
  'restaurante-lasarte':  { slug: 'lasarte',              name: 'Lasarte' },
  // Amar (Rafa Zafra's seafood) — Eater lists as "Amar Barcelona"
  'amar-barcelona':       { slug: 'amar',                 name: 'Amar' },
  // COME by Paco Méndez (Mexican fine dining, 1-star) — CNT truncates to "COME Barcelona"
  'come-barcelona':       { slug: 'come-by-paco-mendez',  name: 'COME by Paco Méndez' },
  // Terraza Martínez (Montjuïc rooftop) — Eater drops "Terraza", CNT drops the accent
  'martinez':             { slug: 'terraza-martinez',     name: 'Terraza Martínez' },
  'terraza-martinez':     { slug: 'terraza-martinez',     name: 'Terraza Martínez' },
};

// Resolve a raw name → canonical {slug, name, displayName}
// Entries not in the merge table get slug=slugify(name), displayName=name.
function canonicalize(rawName) {
  const rawSlug = slugify(rawName);
  const merged = CANONICAL_MERGES[rawSlug];
  if (merged) return { slug: merged.slug, name: merged.name };
  return { slug: rawSlug, name: rawName };
}

// ── Load raw sources ──

const timeoutEntries = JSON.parse(readFileSync(resolve(REPO_ROOT, 'trips/places/barcelona-test.json'), 'utf-8'));
const cntRaw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'cnt-barcelona-raw.json'), 'utf-8'));
const michelinRaw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'michelin-barcelona-raw.json'), 'utf-8'));
const eaterRaw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'eater-barcelona-raw.json'), 'utf-8'));

// ── Normalize each source into canonical shape ──

function makeEntry(rawName, highlights, source) {
  const { slug, name } = canonicalize(rawName);
  return {
    id: slug,
    name,
    neighborhood: null,
    address: null,
    price: null,
    cuisine: null,
    openFor: null,
    highlights,
    insiderTip: null,
    website: null,
    inTargetArea: true,
    notes: null,
    sources: [source],
  };
}

function normalizeCnt() {
  return cntRaw.map((it, idx) => makeEntry(
    unesc(it.name),
    firstSentences(it.originalVenue?.dek || '', 3, 500),
    { type: 'cnt', detail: "Condé Nast Traveler — 34 Best Restaurants in Barcelona", rank: idx + 1 },
  ));
}

function normalizeMichelin() {
  const STAR_LABEL = {
    THREE_STARS: 'Michelin ★★★',
    TWO_STARS: 'Michelin ★★',
    ONE_STAR: 'Michelin ★',
    BIB_GOURMAND: 'Michelin Bib Gourmand',
  };
  return michelinRaw.map(it => {
    const starLabel = STAR_LABEL[it.distinction] || 'Michelin';
    return makeEntry(
      unesc(it.name),
      `${starLabel} restaurant in Barcelona.`,
      { type: 'michelin', detail: `${starLabel} (Michelin Guide Spain)`, distinction: it.distinction },
    );
  });
}

function normalizeEater() {
  return eaterRaw.map((it, idx) => makeEntry(
    unesc(it.name),
    firstSentences(it.review || '', 3, 500),
    { type: 'eater', detail: 'Eater — 38 Best Restaurants in Barcelona', rank: idx + 1 },
  ));
}

function normalizeTimeout() {
  // Time Out entries already in the canonical shape, but run them through
  // canonicalize() too so any future name-drift is handled uniformly.
  return timeoutEntries.map(e => {
    const { slug, name } = canonicalize(e.name);
    return { ...e, id: slug, name };
  });
}

// ── Merge — collect everything keyed by canonical id, union sources ──

const byId = new Map();

function addAll(entries) {
  for (const e of entries) {
    const existing = byId.get(e.id);
    if (!existing) {
      byId.set(e.id, { ...e });
      continue;
    }
    // Union sources (dedup by type+detail)
    for (const s of e.sources) {
      if (!existing.sources.find(es => es.type === s.type && es.detail === s.detail)) {
        existing.sources.push(s);
      }
    }
    // Prefer the longest highlights — editorial quality varies across sources
    if (e.highlights && (!existing.highlights || e.highlights.length > existing.highlights.length)) {
      existing.highlights = e.highlights;
    }
    // Preserve fields that may already be filled in on the existing entry
    for (const field of ['neighborhood', 'address', 'price', 'cuisine', 'openFor', 'insiderTip', 'website', 'notes']) {
      if (existing[field] == null && e[field] != null) existing[field] = e[field];
    }
  }
}

addAll(normalizeTimeout());
addAll(normalizeCnt());
addAll(normalizeMichelin());
addAll(normalizeEater());

// ── World's 50 Best ──

const worldsBest = [
  { name: 'Enigma', rank: 34, year: 2025 },
  { name: 'Cocina Hermanos Torres', rank: 78, year: 2025 },
  { name: 'Disfrutar', rank: 1, year: 2024 },
];
addAll(worldsBest.map(wb => makeEntry(
  wb.name,
  `Listed on The World's 50 Best Restaurants ${wb.year} (#${wb.rank}).`,
  { type: '50best', detail: `The World's 50 Best Restaurants ${wb.year} #${wb.rank}`, rank: wb.rank },
)));

// ── Reddit (hand-curated from r/Barcelona threads) ──
//
// Scraped three r/Barcelona threads via old.reddit.com:
//   1. "Top Favorite Restaurants" (10jv1lm) — 90 comments
//   2. "Where are your favourite restaurants to go to for large-ish groups?" (tau5zl)
//   3. "High quality, medium price restaurants with no bullshit?" (6bwvnk) — 51 comments
//
// These are the picks I made by hand after reading the threads. Rules:
// - `mentions` = count of distinct comments recommending this place (ignoring
//   noise, troll replies, and contested mentions)
// - Skipped restaurants mentioned once with weak context
// - Skipped places with mixed sentiment (Chen Ji had [15pt] rec but also
//   [8pt] "Chen Ji is horrible" — unclear)
// - Existing-match entries just add the reddit source; new entries become
//   full rows. Enrichment fills in rating/price/photos from Google Places.
const REDDIT_THREADS = [
  { id: '10jv1lm', title: 'Top Favorite Restaurants', url: 'https://www.reddit.com/r/Barcelona/comments/10jv1lm/top_favorite_restaurants/' },
  { id: 'tau5zl',  title: 'Favourite restaurants for large-ish groups', url: 'https://www.reddit.com/r/Barcelona/comments/tau5zl/' },
  { id: '6bwvnk',  title: 'High quality, medium price restaurants with no bullshit?', url: 'https://www.reddit.com/r/Barcelona/comments/6bwvnk/' },
];

const REDDIT_FINDS = [
  // Strong recommendations for restaurants already in the editorial data —
  // Reddit adds crowd-wisdom signal on top.
  { name: 'Maleducat',         mentions: 1, note: '€20-50 range pick (r/Barcelona, 10 points)' },
  { name: 'Mont Bar',          mentions: 2, note: '€50+ pick + other mentions (r/Barcelona)' },
  { name: 'Koy Shunka',        mentions: 1, note: '"fantastic Japanese haute cuisine" (r/Barcelona, 7 points)' },
  { name: 'Batea',             mentions: 1, note: 'r/Barcelona mention' },
  { name: 'Besta',             mentions: 1, note: '"if you liked Batea" (r/Barcelona)' },
  { name: 'Xuba Tacos',        mentions: 1, note: '€20-50 pick (r/Barcelona)' },
  { name: 'Ultramarinos Marin', mentions: 1, note: 'on several "worth trying" lists' },

  // New high-signal finds — not in any editorial list, worth adding.
  // These get minimal highlights; enrichment fills everything else.
  { name: 'El Pachuco',  mentions: 3, isNew: true,
    highlights: 'Beloved cheap Mexican in Barcelona — nachos are the signature ("10/10 is the bomb"). Conchinitas and micheladas also praised. Under €20pp.',
    cuisine: 'Mexican' },
  { name: 'Yakumanka',   mentions: 2, isNew: true,
    highlights: "Gastón Acurio's Peruvian restaurant on Enrique Granados. Ceviche and authentic Peruvian from one of the genre's most famous chefs.",
    cuisine: 'Peruvian' },
  { name: 'Xerta Restaurant', mentions: 2, isNew: true,
    highlights: 'Michelin-starred restaurant focused on Delta de l\u2019Ebre cuisine — seafood sourced daily from the delta. Executive lunch menu ~€35 (one of the better-value Michelin options in the city).',
    cuisine: 'Modern Catalan / Delta de l\u2019Ebre' },
  { name: 'Bar H',       mentions: 2, isNew: true,
    highlights: 'Hole-in-the-wall home-made Italian pasta — €7.50 a plate. "Unbeatable. The owner Gianfranco is a legend." Under €10pp.',
    cuisine: 'Italian' },
  { name: 'Dos Pebrots', mentions: 1, isNew: true,
    highlights: 'Albert Raurich\u2019s (ex-Tickets) take on the history of Mediterranean cooking. On multiple r/Barcelona "restaurants I want to try" lists.',
    cuisine: 'Modern Mediterranean' },
  { name: 'Somodo',      mentions: 1, isNew: true,
    highlights: 'Japanese-Mediterranean fusion in Gràcia. Two set menus at fair prices. Small room, slightly awkward service, but "really good" food.',
    cuisine: 'Japanese-Mediterranean fusion' },
  { name: 'Julivert Meu', mentions: 1, isNew: true,
    highlights: 'Traditional Catalan food in a rustic country-house setting. "Absolutely delicious." ~€30-40 per person.',
    cuisine: 'Traditional Catalan' },
];

const REDDIT_SOURCE_DETAIL = `r/Barcelona — ${REDDIT_THREADS.length} threads cross-referenced`;

for (const f of REDDIT_FINDS) {
  const entry = makeEntry(
    f.name,
    f.highlights || null,
    {
      type: 'reddit',
      detail: f.note || REDDIT_SOURCE_DETAIL,
      mentions: f.mentions,
    },
  );
  if (f.cuisine) entry.cuisine = f.cuisine;
  addAll([entry]);
}

const out = Array.from(byId.values());
out.sort((a, b) => {
  if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length;
  return a.name.localeCompare(b.name);
});

writeFileSync(resolve(REPO_ROOT, 'trips/places/barcelona-full.json'), JSON.stringify(out, null, 2));

// ── Report ──

console.log(`Wrote ${out.length} entries → trips/places/barcelona-full.json`);
console.log(`  Time Out:   ${timeoutEntries.length}`);
console.log(`  CNT:        ${cntRaw.length}`);
console.log(`  Michelin:   ${michelinRaw.length}`);
console.log(`  Eater:      ${eaterRaw.length}`);
console.log(`  50 Best:    ${worldsBest.length}`);
console.log(`  Reddit:     ${REDDIT_FINDS.length} finds from ${REDDIT_THREADS.length} threads`);
console.log(`  Multi-source (2+): ${out.filter(r => r.sources.length > 1).length}`);
console.log(`  Multi-source (3+): ${out.filter(r => r.sources.length > 2).length}`);
console.log(`\nMulti-source restaurants:`);
for (const r of out.filter(r => r.sources.length > 1).slice(0, 40)) {
  console.log(`  ${r.sources.length}× ${r.name} — ${r.sources.map(s => s.type).join(', ')}`);
}
