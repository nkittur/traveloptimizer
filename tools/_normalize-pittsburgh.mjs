#!/usr/bin/env node
// _normalize-pittsburgh.mjs — Merge all Pittsburgh sources (Eater, The Infatuation,
// Pittsburgh Magazine, Reddit) into a single normalized JSON with
// cross-source overlap detection.
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { slugify } from './_db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// ── Text cleanup helpers (from Barcelona reference) ──

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
  if (!out && clean.length) {
    const hardLimit = clean.slice(0, maxChars);
    const lastSpace = hardLimit.lastIndexOf(' ');
    out = (lastSpace > maxChars * 0.5 ? hardLimit.slice(0, lastSpace) : hardLimit).trim() + '…';
  }
  return out || null;
}

// ── Canonical merge table — explicit, hand-verified ──

const CANONICAL_MERGES = {
  // Eater lists "Chengdu Gourmet 2" (newer location); Infatuation + PittMag say "Chengdu Gourmet"
  'chengdu-gourmet-2':                 { slug: 'chengdu-gourmet',    name: 'Chengdu Gourmet' },
  // Eater lists "Alta Via (multiple locations)"; PittMag says "Alta Via"
  'alta-via-multiple-locations':       { slug: 'alta-via',           name: 'Alta Via' },
  // PittMag says "Dish Osteria and Bar" (no ampersand)
  'dish-osteria-and-bar':              { slug: 'dish-osteria-bar',   name: 'Dish Osteria & Bar' },
  'dish-osteria-bar':                  { slug: 'dish-osteria-bar',   name: 'Dish Osteria & Bar' },
  // Eater says "EYV Restaurant"; PittMag says "EYV"
  'eyv-restaurant':                    { slug: 'eyv',                name: 'EYV' },
  // Eater says "Hyeholde Restaurant"; PittMag says "Hyeholde"
  'hyeholde-restaurant':               { slug: 'hyeholde',           name: 'Hyeholde' },
  // Eater says "Tessaro's American Bar & Hardwood Grill" — shorten
  'tessaros-american-bar-hardwood-grill': { slug: 'tessaros',        name: "Tessaro's" },
  // Eater says "Hidden Harbor/Independent Brewing Company" — shorten
  'hidden-harborindependent-brewing-company': { slug: 'hidden-harbor', name: 'Hidden Harbor' },
  // PittMag "Fet-Fisk" vs Eater "Fet Fisk" — slugify handles both to "fet-fisk"
  // PittMag "One by Spork" — keep as is (distinct from the pop-up "Spork")
  // Infatuation "40 North at Alphabet City" — keep full name
};

function canonicalize(rawName) {
  const rawSlug = slugify(rawName);
  const merged = CANONICAL_MERGES[rawSlug];
  if (merged) return { slug: merged.slug, name: merged.name };
  return { slug: rawSlug, name: rawName };
}

// ── Load raw sources ──

const eaterRaw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'eater-pittsburgh-raw.json'), 'utf-8'));
const infatuationRaw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'infatuation-pittsburgh-raw.json'), 'utf-8'));
const pittmagRaw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'pittmag-pittsburgh-raw.json'), 'utf-8'));

// ── Source article URLs ──

const SOURCE_ARTICLES = {
  eater: {
    url: 'https://dc.eater.com/maps/best-pittsburgh-restaurants',
    detail: 'Eater — 38 Essential Pittsburgh Restaurants',
  },
  infatuation: {
    url: 'https://www.theinfatuation.com/pittsburgh/guides/pittsburgh-restaurants',
    detail: 'The Infatuation — 19 Best Restaurants in Pittsburgh',
  },
  pittmag: {
    url: 'https://www.pittsburghmagazine.com/here-are-the-25-best-restaurants-in-pittsburgh/',
    detail: 'Pittsburgh Magazine — 26 Best Restaurants (2025)',
  },
};

// ── Hand-crafted descriptions (loaded in Pass 2, empty for Pass 1) ──

let handCrafted = {};
try {
  handCrafted = JSON.parse(readFileSync(resolve(REPO_ROOT, 'trips/places/pittsburgh-descriptions.json'), 'utf-8'));
} catch { /* not yet created — Pass 1 */ }

// ── Normalize each source ──

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

function normalizeEater() {
  const art = SOURCE_ARTICLES.eater;
  return eaterRaw.map((it, idx) => makeEntry(
    unesc(it.name),
    it.review || '',
    { type: 'eater', detail: art.detail, url: art.url, rank: idx + 1 },
  ));
}

function normalizeInfatuation() {
  const art = SOURCE_ARTICLES.infatuation;
  return infatuationRaw.map((it, idx) => {
    const entry = makeEntry(
      unesc(it.name),
      it.review || '',
      { type: 'infatuation', detail: art.detail, url: art.url, rank: idx + 1 },
    );
    if (it.category) entry.category = it.category;
    return entry;
  });
}

function normalizePittmag() {
  const art = SOURCE_ARTICLES.pittmag;
  return pittmagRaw.map((it, idx) => makeEntry(
    unesc(it.name),
    it.review || '',
    { type: 'pittmag', detail: art.detail, url: art.url, rank: idx + 1 },
  ));
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

addAll(normalizeEater());
addAll(normalizeInfatuation());
addAll(normalizePittmag());

// ── Reddit (hand-curated from 3 r/Pittsburgh threads) ──

const REDDIT_THREADS = [
  { id: '1ep01t3', title: 'What are the top 10 must try restaurants in Pittsburgh', url: 'https://www.reddit.com/r/pittsburgh/comments/1ep01t3/what_are_the_top_10_must_try_restaurants_in/' },
  { id: '1erm6od', title: 'Money no object — absolute best restaurant in Pittsburgh', url: 'https://www.reddit.com/r/pittsburgh/comments/1erm6od/money_being_no_object_whats_the_absolute_best/' },
  { id: '1l7cvuk', title: 'Best inexpensive spots in Pittsburgh', url: 'https://www.reddit.com/r/pittsburgh/comments/1l7cvuk/the_25_best_restaurants_is_full_of_expensive/' },
];

// Load each thread's comments for per-restaurant attribution
const threadData = [];
for (let i = 0; i < REDDIT_THREADS.length; i++) {
  try {
    const file = resolve(REPO_ROOT, `reddit-thread-${i + 1}.json`);
    const raw = JSON.parse(readFileSync(file, 'utf-8'));
    const blob = (raw.postBody || '') + ' ' + (raw.comments || []).map(c => c.body).join(' ');
    threadData.push({ ...REDDIT_THREADS[i], blob: blob.toLowerCase(), comments: raw.comments || [] });
  } catch {
    threadData.push({ ...REDDIT_THREADS[i], blob: '', comments: [] });
  }
}

function threadsMentioning(restaurantName, aliases = []) {
  const candidates = [restaurantName, ...aliases].map(n => n.toLowerCase());
  return threadData.filter(t => candidates.some(c => t.blob.includes(c)))
    .map(t => ({ title: t.title, url: t.url }));
}

// Reddit picks — hand-curated by reading top-scored comments
const REDDIT_FINDS = [
  // ── Cross-validates editorial picks ──
  { name: 'Pusadee\'s Garden',  aliases: ["pusadee's", "pusadees"] },
  { name: 'Fet Fisk',           aliases: ['fet fisk', 'fet-fisk'] },
  { name: 'Morcilla',           aliases: [] },
  { name: 'Apteka',             aliases: [] },
  { name: 'Soju',               aliases: [] },
  { name: 'Lilith',             aliases: [] },
  { name: 'Altius',             aliases: [] },
  { name: 'Dish Osteria & Bar', aliases: ['dish osteria', 'dish'] },
  { name: 'DiAnoia\'s Eatery',  aliases: ["dianoia", "di'anoia", "dianoias"] },
  { name: 'Bar Marco',          aliases: ['bar marco'] },
  { name: 'Alta Via',           aliases: ['alta via'] },
  { name: 'Chengdu Gourmet',    aliases: ['chengdu gourmet', 'chengdu'] },
  { name: 'Everyday Noodles',   aliases: ['everyday noodles', 'everyday'] },
  { name: 'Con Alma',           aliases: ['con alma'] },
  { name: 'Butterjoint',        aliases: ['butterjoint'] },

  // ── New Reddit-only finds — not on editorial lists ──
  // Brief highlights are placeholders for Pass 1; will be rewritten in Pass 2.
  { name: 'Noodlehead',         aliases: ['noodlehead'], isNew: true,
    category: 'Thai street food',
    highlights: 'Massively popular Thai street food — steam buns and street noodle #1 are the signatures. Expect a wait.' },
  { name: 'Big Jim\'s',         aliases: ["big jim's", "big jims"], isNew: true,
    category: 'Italian-American',
    highlights: 'Old-school Italian-American in Greenfield. Huge portions and a Pittsburgh institution for generations.' },
  { name: 'Chicken Latino',     aliases: ['chicken latino'], isNew: true,
    category: 'Peruvian rotisserie',
    highlights: 'Peruvian rotisserie chicken with sides to feed a family for under $35. Beechview staple.' },
  { name: 'Salem\'s Market & Grill', aliases: ['salems', "salem's"], isNew: true,
    category: 'Middle Eastern',
    highlights: 'Strip District Middle Eastern market and grill. Beloved for years by Pittsburgh locals.' },
  { name: 'Umi',                aliases: ['umi', 'omakase at umi'], isNew: true,
    category: 'Japanese / omakase',
    highlights: 'Pittsburgh\'s top omakase experience. The sushi counter is where you want to be.' },
  { name: 'Pierogies Plus',     aliases: ['pierogies plus'], isNew: true,
    category: 'Pierogies / Eastern European',
    highlights: '"A distillation of Pittsburgh\'s soul." Hand-made pierogies in McKees Rocks — the city\'s quintessential comfort food.' },
  { name: 'Bombay to Burgh',    aliases: ['bombay to burgh'], isNew: true,
    category: 'Indian',
    highlights: '"Easily the best Indian food I\'ve ever had" — r/Pittsburgh. A local favorite for authentic Indian cooking.' },
  { name: 'Tram\'s Kitchen',    aliases: ["tram's kitchen", "trams kitchen"], isNew: true,
    category: 'Vietnamese',
    highlights: 'Tiny Vietnamese spot. The coconut milk vermicelli is a must. Cash only, limited seating.' },
  { name: 'Las Palmas',         aliases: ['las palmas'], isNew: true,
    category: 'Mexican',
    highlights: 'Beechview Mexican spot beloved by r/Pittsburgh. Multiple mentions across threads.' },
];

for (const f of REDDIT_FINDS) {
  const matchedThreads = threadsMentioning(f.name, f.aliases || []);
  if (matchedThreads.length === 0) continue; // per L18: no match → no reddit source

  const detail = matchedThreads.length === 1
    ? `r/Pittsburgh — ${matchedThreads[0].title}`
    : `r/Pittsburgh — ${matchedThreads.length} threads`;

  const entry = makeEntry(
    f.name,
    f.highlights || null,
    {
      type: 'reddit',
      detail,
      threads: matchedThreads,
      mentions: matchedThreads.length,
    },
  );
  if (f.category) entry.category = f.category;
  if (f.highlights) entry.highlights = f.highlights;
  addAll([entry]);
}

// ── Compose highlights ──

const NARRATIVE_PREFERENCE = ['eater', 'infatuation', 'pittmag', 'reddit'];

function composeHighlights(entry) {
  const override = handCrafted[entry.id];
  if (override) return override;

  // Fallback for Pass 1
  const raws = entry._rawDescs || {};
  for (const type of NARRATIVE_PREFERENCE) {
    if (raws[type] && raws[type].length >= 40) {
      return sentenceTruncate(raws[type], 700);
    }
  }
  return null;
}

for (const entry of byId.values()) {
  entry.highlights = composeHighlights(entry);
  delete entry._rawDescs;
}

const out = Array.from(byId.values());
out.sort((a, b) => {
  if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length;
  return a.name.localeCompare(b.name);
});

writeFileSync(resolve(REPO_ROOT, 'trips/places/pittsburgh-full.json'), JSON.stringify(out, null, 2));

// ── Report ──

console.log(`Wrote ${out.length} entries → trips/places/pittsburgh-full.json`);
console.log(`  Eater:        ${eaterRaw.length}`);
console.log(`  Infatuation:  ${infatuationRaw.length}`);
console.log(`  PittMag:      ${pittmagRaw.length}`);
console.log(`  Reddit finds: ${REDDIT_FINDS.length} from ${REDDIT_THREADS.length} threads`);
console.log(`  Multi-source (2+): ${out.filter(r => r.sources.length > 1).length}`);
console.log(`  Multi-source (3+): ${out.filter(r => r.sources.length > 2).length}`);
console.log(`\nMulti-source restaurants:`);
for (const r of out.filter(r => r.sources.length > 1).slice(0, 50)) {
  console.log(`  ${r.sources.length}× ${r.name} — ${r.sources.map(s => s.type).join(', ')}`);
}
console.log(`\nReddit-only new finds:`);
for (const r of out.filter(r => r.sources.length === 1 && r.sources[0].type === 'reddit')) {
  console.log(`  ${r.name} (${r.category || '?'})`);
}
