#!/usr/bin/env node
// _normalize-asheville.mjs — Merge Asheville restaurant sources (Eater 18 Best,
// Eater 17 Hottest, Reddit r/asheville) into normalized JSON.
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { slugify } from './_db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

function unesc(s) {
  if (!s) return s;
  return String(s)
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, '\u2019').replace(/&lsquo;/g, '\u2018')
    .replace(/&rdquo;/g, '\u201d').replace(/&ldquo;/g, '\u201c')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
    .replace(/\s*\{:\s*[^}]+\}/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s+/g, ' ').trim();
}

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
  return out.trim() || clean.slice(0, maxChars).trimEnd() + '…';
}

// ── Canonical merges ──
const CANONICAL_MERGES = {
  "leo-s-house-of-thirst":      { slug: 'leos-house-of-thirst', name: "Leo's House of Thirst" },
  "rosetta-s-kitchen-the-buchi-bar": { slug: 'rosettas-kitchen', name: "Rosetta's Kitchen" },
  "tall-john-s":                 { slug: 'tall-johns', name: "Tall John's" },
  "neng-jr-s":                   { slug: 'neng-jrs', name: "Neng Jr.'s" },
  "posana-biltmore-park":        { slug: 'posana', name: 'Posana' },
  // Reddit short names
  "cucina-24":                   { slug: 'cucina-24', name: 'Cucina 24' },
};

function canonicalize(rawName) {
  const rawSlug = slugify(rawName);
  const merged = CANONICAL_MERGES[rawSlug];
  if (merged) return { slug: merged.slug, name: merged.name };
  return { slug: rawSlug, name: rawName };
}

// ── Load raw sources ──
const eaterBest = JSON.parse(readFileSync(resolve(REPO_ROOT, 'eater-asheville-raw.json'), 'utf-8'));
const eaterHottest = JSON.parse(readFileSync(resolve(REPO_ROOT, 'eater-hottest-asheville-raw.json'), 'utf-8'));
let tncRaw = [];
try { tncRaw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'tnc-asheville-raw.json'), 'utf-8')); } catch {}

const SOURCE_ARTICLES = {
  eater: {
    url: 'https://carolinas.eater.com/maps/best-asheville-restaurants',
    detail: 'Eater — 18 Best Restaurants in Asheville',
  },
  eaterhot: {
    url: 'https://carolinas.eater.com/maps/best-new-restaurants-asheville',
    detail: 'Eater — 17 Hottest Restaurants in Asheville',
  },
  tnc: {
    url: 'https://www.townandcountrymag.com/leisure/travel-guide/a46772119/t-and-c-travel-guide-3-days-in-asheville/',
    detail: 'Town & Country — 3 Days in Asheville',
  },
};

// ── Hand-crafted descriptions (Pass 2) ──
let handCrafted = {};
try {
  handCrafted = JSON.parse(readFileSync(resolve(REPO_ROOT, 'trips/places/asheville-descriptions.json'), 'utf-8'));
} catch {}

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
    highlights: null,
    insiderTip: null,
    website: null,
    inTargetArea: true,
    notes: null,
    sources: [source],
    _rawDescs: rawDescription ? { [source.type]: unesc(rawDescription) } : {},
  };
}

const byId = new Map();
function addAll(entries) {
  for (const e of entries) {
    const existing = byId.get(e.id);
    if (!existing) {
      byId.set(e.id, { ...e, _rawDescs: { ...(e._rawDescs || {}) } });
      continue;
    }
    for (const s of e.sources) {
      if (!existing.sources.find(es => es.type === s.type && es.detail === s.detail)) {
        existing.sources.push(s);
      }
    }
    existing._rawDescs ||= {};
    for (const [type, desc] of Object.entries(e._rawDescs || {})) {
      if (desc && !existing._rawDescs[type]) existing._rawDescs[type] = desc;
    }
    for (const field of ['neighborhood', 'address', 'price', 'category', 'openFor', 'insiderTip', 'website', 'notes']) {
      if (existing[field] == null && e[field] != null) existing[field] = e[field];
    }
  }
}

// ── Eater 18 Best ──
addAll(eaterBest.map((it, idx) => makeEntry(
  it.name, it.review || '',
  { type: 'eater', detail: SOURCE_ARTICLES.eater.detail, url: SOURCE_ARTICLES.eater.url, rank: idx + 1 },
)));

// ── Eater 17 Hottest ──
addAll(eaterHottest.map((it, idx) => makeEntry(
  it.name, it.review || '',
  { type: 'eaterhot', detail: SOURCE_ARTICLES.eaterhot.detail, url: SOURCE_ARTICLES.eaterhot.url, rank: idx + 1 },
)));

// ── T&C 3 Days (restaurants only — only from sections marked "restaurant") ──
// Filter out false positives: towns (Black Mountain, Weaverville), truncations,
// tour/event names that aren't restaurants.
const TNC_REST_SKIP = new Set(['Black Mountain', 'Weaverville', 'The Med,']);
const TNC_REST_REMAP = {
  'Cucina24': 'Cucina 24',  // match our canonical
  "Rosetta's Kitchen": "Rosetta's Kitchen",  // existing slug
};
const tncRestaurants = tncRaw.filter(e => e.type === 'restaurant' && !TNC_REST_SKIP.has(e.name));
for (const r of tncRestaurants) {
  const name = TNC_REST_REMAP[r.name] || r.name;
  addAll([makeEntry(name, r.context,
    { type: 'tnc', detail: SOURCE_ARTICLES.tnc.detail, url: SOURCE_ARTICLES.tnc.url, day: r.day })]);
}

// ── Reddit (hand-curated from 3 r/asheville threads) ──
const REDDIT_THREADS_AVL = [
  { id: '1lg9tue', title: 'All the restaurants my family visited, thanks to you!', url: 'https://www.reddit.com/r/asheville/comments/1lg9tue/all_the_restaurants_my_family_visited_thanks_to/' },
  { id: '1djt440', title: 'Nicest Restaurant in Asheville', url: 'https://www.reddit.com/r/asheville/comments/1djt440/nicest_restaurant_in_asheville/' },
  { id: '1jx7xar', title: 'Recommendations for dinner spots', url: 'https://www.reddit.com/r/asheville/comments/1jx7xar/recommendations_for_dinner_spots/' },
];

const threadDataAVL = [];
for (let i = 0; i < REDDIT_THREADS_AVL.length; i++) {
  try {
    const file = resolve(REPO_ROOT, `reddit-avl-thread-${i + 1}.json`);
    const raw = JSON.parse(readFileSync(file, 'utf-8'));
    const blob = (raw.postBody || '') + ' ' + (raw.comments || []).map(c => c.body).join(' ');
    threadDataAVL.push({ ...REDDIT_THREADS_AVL[i], blob: blob.toLowerCase(), comments: raw.comments || [] });
  } catch {
    threadDataAVL.push({ ...REDDIT_THREADS_AVL[i], blob: '', comments: [] });
  }
}

function threadsMentioningAVL(name, aliases = []) {
  const candidates = [name, ...aliases].map(n => n.toLowerCase());
  return threadDataAVL.filter(t => candidates.some(c => t.blob.includes(c)))
    .map(t => ({ title: t.title, url: t.url }));
}

const REDDIT_FINDS_AVL = [
  // Cross-validate editorial picks
  { name: 'Cúrate', aliases: ['curate'] },
  { name: "Leo's House of Thirst", aliases: ['leo\'s', 'leos house'] },
  { name: "Neng Jr.'s", aliases: ['neng jr', 'nengs'] },
  { name: 'Jargon', aliases: ['jargon'] },
  { name: 'Chai Pani', aliases: ['chai pani'] },
  { name: 'Plant', aliases: [] },
  { name: 'Posana', aliases: ['posana'] },
  { name: 'Gypsy Queen Cuisine', aliases: ['gypsy queen'] },

  // Reddit-only new finds
  { name: 'Cucina 24', aliases: ['cucina 24', 'cucina24'], isNew: true,
    category: 'Italian',
    highlights: 'Most-praised restaurant in r/Asheville (68+63+45 upvotes). Chef Brian Canipelli\'s upscale Italian downtown — "one of the best meals I\'ve had in a while anywhere."' },
  { name: 'Ukiah', aliases: ['ukiah'], isNew: true,
    category: 'Modern American',
    highlights: 'r/Asheville\'s top "money-no-object" pick — lovely room, top-tier food. The off-sashimi salmon is singled out as the best in the city.' },
  { name: 'Vivian', aliases: ['vivian'], isNew: true,
    category: 'New American',
    highlights: 'Upscale New American in an intimate space. A consistent r/Asheville pick for special occasions alongside Cucina 24 and Ukiah.' },
  { name: 'Bull & Beggar', aliases: ['bull & beggar', 'bull and beggar'], isNew: true,
    category: 'Seafood / New American',
    highlights: 'River Arts District seafood and raw bar — Sunday Burger Night is an institution. Multiple James Beard nominations. An Asheville fine-dining staple.' },
  { name: 'Chestnut', aliases: ['chestnut'], isNew: true,
    category: 'New American',
    highlights: 'Downtown American bistro — r/Asheville calls it a reliable, elevated choice. Solid cocktails and a seasonal menu.' },
  { name: 'Zambra', aliases: ['zambra'], isNew: true,
    category: 'Spanish tapas',
    highlights: 'Spanish tapas and live flamenco in a candlelit downtown basement. Long-running r/Asheville favorite alongside Cúrate.' },
  { name: 'Copper Crown', aliases: ['copper crown'], isNew: true,
    category: 'Southern',
    highlights: 'East Asheville Southern spot. "The Brussels are probably my favorite dish in town, they never disappoint" (r/Asheville, 11 upvotes).' },
  { name: '828 Pizza', aliases: ['828 pizza', '828'], isNew: true,
    category: 'Pizza',
    highlights: '"Our favorite pizza around" — r/Asheville. NY-style pies in a casual neighborhood spot. The original south location closed but the flagship is still thriving.' },
  { name: 'Mehfil', aliases: ['mehfil'], isNew: true,
    category: 'Indian',
    highlights: 'r/Asheville\'s top Indian recommendation — featured on the "recommendations for next time" list after a family trip-report.' },
  { name: 'Nine Mile', aliases: ['nine mile'], isNew: true,
    category: 'Caribbean-Italian',
    highlights: 'Caribbean-inspired pasta dishes in Montford — a uniquely Asheville fusion that locals insist visitors must try.' },
  { name: 'Limones', aliases: ['limones'], isNew: true,
    category: 'Mexican / Californian',
    highlights: 'Mexican-Californian fusion downtown. Fresh margaritas, creative takes on tacos and mole. An r/Asheville dinner-out staple.' },
];

for (const f of REDDIT_FINDS_AVL) {
  const matchedThreads = threadsMentioningAVL(f.name, f.aliases || []);
  if (matchedThreads.length === 0) continue;

  const detail = matchedThreads.length === 1
    ? `r/Asheville — ${matchedThreads[0].title}`
    : `r/Asheville — ${matchedThreads.length} threads`;

  const entry = makeEntry(
    f.name,
    f.highlights || null,
    { type: 'reddit', detail, threads: matchedThreads, mentions: matchedThreads.length },
  );
  if (f.category) entry.category = f.category;
  if (f.highlights) entry.highlights = f.highlights;
  addAll([entry]);
}

// ── Compose highlights ──
const NARRATIVE_PREFERENCE = ['eater', 'eaterhot', 'tnc', 'reddit'];
function composeHighlights(entry) {
  const override = handCrafted[entry.id];
  if (override) return override;
  const raws = entry._rawDescs || {};
  for (const type of NARRATIVE_PREFERENCE) {
    if (raws[type] && raws[type].length >= 40) {
      return sentenceTruncate(raws[type], 700);
    }
  }
  return null;
}

for (const entry of byId.values()) {
  entry.highlights = entry.highlights || composeHighlights(entry);
  delete entry._rawDescs;
}

const out = Array.from(byId.values()).filter(e => e.highlights);
out.sort((a, b) => {
  if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length;
  return a.name.localeCompare(b.name);
});

writeFileSync(resolve(REPO_ROOT, 'trips/places/asheville-full.json'), JSON.stringify(out, null, 2));

console.log(`Wrote ${out.length} entries → trips/places/asheville-full.json`);
console.log(`  Eater 18 Best:    ${eaterBest.length}`);
console.log(`  Eater 17 Hottest: ${eaterHottest.length}`);
console.log(`  Reddit finds:     ${REDDIT_FINDS_AVL.length} from ${REDDIT_THREADS_AVL.length} threads`);
console.log(`  Multi-source (2+): ${out.filter(r => r.sources.length > 1).length}`);
console.log(`  Multi-source (3+): ${out.filter(r => r.sources.length > 2).length}`);
console.log(`\nMulti-source:`);
for (const r of out.filter(r => r.sources.length > 1).slice(0, 30)) {
  console.log(`  ${r.sources.length}× ${r.name} — ${r.sources.map(s => s.type).join(', ')}`);
}
console.log(`\nReddit-only:`);
for (const r of out.filter(r => r.sources.length === 1 && r.sources[0].type === 'reddit')) {
  console.log(`  ${r.name}`);
}
