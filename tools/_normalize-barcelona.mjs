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

// Truncate text to complete sentences that fit within maxChars. Never slice
// mid-sentence. If even the first sentence is longer than maxChars, fall back
// to a char-limited version (edge case, rare for review prose).
function sentenceTruncate(s, maxChars = 700) {
  if (!s) return null;
  const clean = unesc(s);
  const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean];
  let out = '';
  for (const sent of sentences) {
    if (out.length > 0 && out.length + sent.length > maxChars) break;
    out += sent;
    if (out.length >= maxChars * 0.95) break;
  }
  out = out.trim();
  // Fallback: if we got nothing (first sentence too long), truncate at
  // the last space before maxChars so we at least don't split a word.
  if (!out && clean.length) {
    const hardLimit = clean.slice(0, maxChars);
    const lastSpace = hardLimit.lastIndexOf(' ');
    out = (lastSpace > maxChars * 0.5 ? hardLimit.slice(0, lastSpace) : hardLimit).trim() + '…';
  }
  return out || null;
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

// Hand-crafted Zagat-style descriptions. Every entry in this file was
// composed by reading all available raw data (editorial prose + Michelin/
// 50 Best credentials + Reddit crowd signal + Google Places user reviews)
// and distilling the key facts into 1-3 tight sentences. No algorithmic
// stitching, no percentage-based filters — it's a judgment call per
// restaurant. See trips/places/barcelona-composition-input.txt for the
// raw inputs that informed each composition.
const handCrafted = JSON.parse(readFileSync(resolve(REPO_ROOT, 'trips/places/barcelona-descriptions.json'), 'utf-8'));

// ── Source article URLs ──
// These get attached to each source entry so the webapp's detail view can
// render linked source titles (open in new tab).
const SOURCE_ARTICLES = {
  cnt: {
    url: 'https://www.cntraveler.com/gallery/best-restaurants-in-barcelona',
    detail: 'Condé Nast Traveler — 34 Best Restaurants in Barcelona',
  },
  eater: {
    url: 'https://www.eater.com/maps/best-restaurants-barcelona-spain',
    detail: 'Eater — 38 Best Restaurants in Barcelona',
  },
  michelin: {
    url: 'https://guide.michelin.com/us/en/catalunya/barcelona/restaurants/all-starred',
    detail: 'Michelin Guide — Barcelona All-Starred',
  },
  timeout: {
    url: 'https://www.timeout.com/barcelona/restaurants/best-restaurants-in-barcelona',
    detail: 'Time Out Barcelona — Best Restaurants',
  },
};

// 50 Best has different URLs per year
const BEST50_URLS = {
  2025: 'https://www.theworlds50best.com/list/1-50',
  2024: 'https://www.theworlds50best.com/the-list/archive/2024',
};

// ── Normalize each source into canonical shape ──

// makeEntry stores the raw, un-truncated description under _rawDescs[sourceType].
// Final `highlights` is composed AFTER all sources are merged — see
// composeHighlights() below.
function makeEntry(rawName, rawDescription, source) {
  const { slug, name } = canonicalize(rawName);
  return {
    id: slug,
    name,
    neighborhood: null,
    address: null,
    price: null,
    category: null,
    openFor: null,
    highlights: null, // composed post-merge
    insiderTip: null,
    website: null,
    inTargetArea: true,
    notes: null,
    sources: [source],
    _rawDescs: rawDescription ? { [source.type]: unesc(rawDescription) } : {},
  };
}

function normalizeCnt() {
  const art = SOURCE_ARTICLES.cnt;
  return cntRaw.map((it, idx) => makeEntry(
    unesc(it.name),
    it.originalVenue?.dek || '',
    { type: 'cnt', detail: art.detail, url: art.url, rank: idx + 1 },
  ));
}

function normalizeMichelin() {
  const art = SOURCE_ARTICLES.michelin;
  return michelinRaw.map(it => makeEntry(
    unesc(it.name),
    null, // Michelin list page has no prose — only the star-count fact (used by composeHighlights)
    { type: 'michelin', detail: art.detail, url: art.url, distinction: it.distinction },
  ));
}

function normalizeEater() {
  const art = SOURCE_ARTICLES.eater;
  return eaterRaw.map((it, idx) => makeEntry(
    unesc(it.name),
    it.review || '',
    { type: 'eater', detail: art.detail, url: art.url, rank: idx + 1 },
  ));
}

function normalizeTimeout() {
  // Time Out entries are already in the canonical shape from the earlier
  // hand-written file. Re-run canonicalize() for name drift, move highlights
  // into _rawDescs, and upgrade the source entry with the article URL.
  const art = SOURCE_ARTICLES.timeout;
  return timeoutEntries.map(e => {
    const { slug, name } = canonicalize(e.name);
    const sources = (e.sources || []).map(s =>
      s.type === 'timeout' ? { ...s, detail: art.detail, url: art.url } : s
    );
    const out = { ...e, id: slug, name, sources, _rawDescs: {} };
    if (e.highlights) out._rawDescs.timeout = unesc(e.highlights);
    return out;
  });
}

// ── Merge — collect everything keyed by canonical id, union sources ──

const byId = new Map();

function addAll(entries) {
  for (const e of entries) {
    const existing = byId.get(e.id);
    if (!existing) {
      byId.set(e.id, { ...e, _rawDescs: { ...(e._rawDescs || {}) } });
      continue;
    }
    // Union sources (dedup by type+detail)
    for (const s of e.sources) {
      if (!existing.sources.find(es => es.type === s.type && es.detail === s.detail)) {
        existing.sources.push(s);
      }
    }
    // Union raw descriptions — first value wins per source type (should
    // never collide since source types map 1:1 to sources)
    existing._rawDescs ||= {};
    for (const [type, desc] of Object.entries(e._rawDescs || {})) {
      if (desc && !existing._rawDescs[type]) existing._rawDescs[type] = desc;
    }
    // Preserve fields that may already be filled in on the existing entry
    for (const field of ['neighborhood', 'address', 'price', 'category', 'openFor', 'insiderTip', 'website', 'notes']) {
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
  {
    type: '50best',
    detail: `The World's 50 Best Restaurants ${wb.year} #${wb.rank}`,
    url: BEST50_URLS[wb.year] || BEST50_URLS[2025],
    rank: wb.rank,
  },
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
    category: 'Mexican' },
  { name: 'Yakumanka',   mentions: 2, isNew: true,
    highlights: "Gastón Acurio's Peruvian restaurant on Enrique Granados. Ceviche and authentic Peruvian from one of the genre's most famous chefs.",
    category: 'Peruvian' },
  { name: 'Xerta Restaurant', mentions: 2, isNew: true,
    highlights: 'Michelin-starred restaurant focused on Delta de l\u2019Ebre cuisine — seafood sourced daily from the delta. Executive lunch menu ~€35 (one of the better-value Michelin options in the city).',
    category: 'Modern Catalan / Delta de l\u2019Ebre' },
  { name: 'Bar H',       mentions: 2, isNew: true,
    highlights: 'Hole-in-the-wall home-made Italian pasta — €7.50 a plate. "Unbeatable. The owner Gianfranco is a legend." Under €10pp.',
    category: 'Italian' },
  { name: 'Dos Pebrots', mentions: 1, isNew: true,
    highlights: 'Albert Raurich\u2019s (ex-Tickets) take on the history of Mediterranean cooking. On multiple r/Barcelona "restaurants I want to try" lists.',
    category: 'Modern Mediterranean' },
  { name: 'Somodo',      mentions: 1, isNew: true,
    highlights: 'Japanese-Mediterranean fusion in Gràcia. Two set menus at fair prices. Small room, slightly awkward service, but "really good" food.',
    category: 'Japanese-Mediterranean fusion' },
  { name: 'Julivert Meu', mentions: 1, isNew: true,
    highlights: 'Traditional Catalan food in a rustic country-house setting. "Absolutely delicious." ~€30-40 per person.',
    category: 'Traditional Catalan' },
];

// Load each thread's comments so we can figure out which thread(s) mention
// each REDDIT_FINDS restaurant by name. Used to attach per-restaurant thread
// links to the source so the detail view can link to the actual threads.
const threadCommentsById = {};
for (const t of REDDIT_THREADS) {
  try {
    // Files live at the repo root (where I saved them with playwright_browser_evaluate)
    const file = resolve(REPO_ROOT, `reddit-thread-${REDDIT_THREADS.indexOf(t) + 1}.json`);
    threadCommentsById[t.id] = JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    threadCommentsById[t.id] = [];
  }
}

function threadsMentioning(restaurantName) {
  // Case-insensitive literal match. Restaurant names are usually distinctive
  // enough that substring matching is safe — "Mont Bar" won't collide with
  // anything, "Bar H" is rare enough to be unambiguous. If a false positive
  // becomes a problem, add a word-boundary regex and an exclude list.
  const needle = restaurantName.toLowerCase();
  const hit = [];
  for (const t of REDDIT_THREADS) {
    const comments = threadCommentsById[t.id] || [];
    if (comments.some(c => c.body?.toLowerCase().includes(needle))) {
      hit.push({ title: t.title, url: t.url });
    }
  }
  return hit;
}

for (const f of REDDIT_FINDS) {
  const matchedThreads = threadsMentioning(f.name);
  // Fallback: if we couldn't find mentions (the scan missed, or the comments
  // used a nickname), just link to all threads.
  const threads = matchedThreads.length ? matchedThreads : REDDIT_THREADS.map(t => ({ title: t.title, url: t.url }));
  const detail = threads.length === 1
    ? `r/Barcelona — ${threads[0].title}`
    : `r/Barcelona — ${threads.length} threads`;
  const entry = makeEntry(
    f.name,
    f.highlights || null,
    {
      type: 'reddit',
      detail,
      threads,
      mentions: f.mentions,
    },
  );
  if (f.category) entry.category = f.category;
  addAll([entry]);
}

// ── Compose final highlights AFTER all sources are merged ──
//
// Zagat-style: each restaurant's description is built from whatever sources
// we have, in this order:
//   1. Credentials line — multi-source facts (Michelin stars, 50 Best rank)
//   2. Narrative — the richest editorial prose available, truncated at a
//      sentence boundary (never mid-sentence)
//   3. Reddit coda — if a Reddit source is present, a short note
//
// This runs AFTER merging, so every entry has all the raw descriptions it's
// ever going to have when we compose. Doing this during ingestion would miss
// multi-source credentials and cause first-arrival-wins truncation bugs.

// Fallback preference order for entries missing a hand-crafted description.
// Should rarely trigger — every Barcelona entry has a hand-crafted line.
const NARRATIVE_PREFERENCE = ['cnt', 'eater', 'timeout', 'reddit'];

// composeHighlights is now a pure lookup into the hand-crafted map.
// Every Barcelona entry has a purpose-written Zagat-style description
// composed from reading ALL source data (editorial + Michelin/50 Best
// credentials + Reddit signal + Google Places user reviews). No
// algorithmic stitching, no percentage filters — it's a judgment call
// per restaurant. If an entry doesn't have a hand-crafted description,
// fall back to the richest raw source text as a last resort.
function composeHighlights(entry) {
  const override = handCrafted[entry.id];
  if (override) return override;

  // Fallback — ideally never hits for Barcelona
  const raws = entry._rawDescs || {};
  for (const type of NARRATIVE_PREFERENCE) {
    if (raws[type] && raws[type].length >= 40) {
      return sentenceTruncate(raws[type], 700);
    }
  }
  return null;
}

// Compose highlights for every entry, then drop the scratch field
for (const entry of byId.values()) {
  entry.highlights = composeHighlights(entry);
  delete entry._rawDescs;
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
